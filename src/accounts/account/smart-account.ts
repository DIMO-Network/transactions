import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getUserOperationGasPrice,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import {
  type Address,
  type Chain,
  createPublicClient,
  defineChain,
  type Hex,
  http,
  isAddress,
  isAddressEqual,
  isHex,
  type LocalAccount,
  zeroAddress,
} from "viem";
import {
  createBundlerClient,
  formatUserOperationRequest,
  getUserOperationError,
  getUserOperationHash,
  type UserOperation,
} from "viem/account-abstraction";

import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig, unboundFetch } from "../config.js";
import {
  GasProxyError,
  parseRetryAfter,
  ProvidersExhaustedError,
  SignerError,
  SponsorshipError,
  UsageError,
  UserOperationPendingError,
  UserOperationRevertedError,
  UserOperationUnknownError,
} from "../errors.js";
import { confirmUserOperation } from "./receipt.js";

export type GasProvider = "alchemy" | "gelato" | "pimlico";

/** Order tried when the caller does not pick one; matches the accounts server's fallback order. */
const DEFAULT_PROVIDERS: GasProvider[] = ["alchemy", "gelato", "pimlico"];

export interface SmartAccountOptions {
  session: Session;
  /** The user's wallet signer, e.g. from `@turnkey/viem` `createAccount`. */
  walletViemAccount: LocalAccount;
  chainId: number;
  /** One provider per attempt, in order. Defaults to alchemy, gelato, pimlico. */
  providers?: GasProvider[];
  /** How long deploy waits for the receipt after submission. Defaults to 120s. */
  receiptTimeoutMs?: number;
}

export interface SendUserOperationOptions extends SmartAccountOptions {
  calls: Array<{ to: Hex; value?: bigint; data?: Hex }>;
}

function chainFor(cfg: SdkConfig, chainId: number): { chain: Chain; rpcUrl: string } {
  const rpcUrl = cfg.rpcUrls[chainId];
  if (!rpcUrl) throw new UsageError("rpc_url_missing", `no rpcUrl configured for chain ${chainId}`);
  const chain = defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return { chain, rpcUrl };
}

/** Chain reads (address, nonce, code) go straight to the configured RPC, unauthenticated. */
function publicClientFor(cfg: SdkConfig, chainId: number) {
  const { chain, rpcUrl } = chainFor(cfg, chainId);
  return {
    chain,
    publicClient: createPublicClient({
      chain,
      transport: http(rpcUrl, { fetchFn: unboundFetch(cfg) }),
    }),
  };
}

/** The plain kernel: ECDSA sudo validator = the user's wallet, index 0, EntryPoint 0.7, kernel v3.1. */
async function plainKernelAccount(
  publicClient: ReturnType<typeof publicClientFor>["publicClient"],
  walletViemAccount: LocalAccount
) {
  const entryPoint = getEntryPoint("0.7");
  const sudo = await signerToEcdsaValidator(publicClient, {
    signer: walletViemAccount,
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });
  return createKernelAccount(publicClient, {
    plugins: { sudo },
    entryPoint,
    kernelVersion: KERNEL_V3_1,
    index: 0n,
  });
}

type KernelAccount = Awaited<ReturnType<typeof plainKernelAccount>>;

/** What every provider attempt shares: built once per call, before the first provider. */
interface Kernel {
  chain: Chain;
  publicClient: ReturnType<typeof publicClientFor>["publicClient"];
  /** Signs through guardSigner, so a wallet failure is a SignerError. */
  account: KernelAccount;
  /**
   * The account's EntryPoint nonce, read from the RPC on first use and then reused by every
   * provider attempt of this call. Two attempts therefore sign the same nonce, so at most
   * one of their ops can ever be included, whatever a provider's error claimed.
   */
  nonce: () => Promise<bigint>;
}

/** Build the shared kernel. Refuses an RPC that serves another chain, before any signing. */
async function kernelFor(cfg: SdkConfig, opts: SmartAccountOptions): Promise<Kernel> {
  const { chain, publicClient } = publicClientFor(cfg, opts.chainId);
  const served = await publicClient.getChainId();
  if (served !== opts.chainId) {
    throw new UsageError("chain_mismatch", `cfg.rpcUrls[${opts.chainId}] serves chain ${served}`);
  }
  const account = await plainKernelAccount(publicClient, guardSigner(opts.walletViemAccount));
  // Kept only once read: a failed read signed nothing, so the next attempt may read again.
  let nonce: bigint | undefined;
  return { chain, publicClient, account, nonce: async () => (nonce ??= await account.getNonce()) };
}

/**
 * Every proxy request but the send (sponsorship, gas price, estimation, lookups, receipts):
 * viem's default, kept short so a hung call falls through to the next provider quickly.
 */
const PROXY_TIMEOUT_MS = 10_000;

/**
 * eth_sendUserOperation only. The accounts proxy waits up to 25 s for the bundler
 * (UPSTREAM_TIMEOUT_MS in its gas-proxy.service.ts) and then answers 504; waiting longer
 * than that lets the proxy's answer arrive before this client gives up on its own.
 */
const SEND_TIMEOUT_MS = 30_000;

function buildClients(
  cfg: SdkConfig,
  opts: SmartAccountOptions,
  { chain, publicClient, account }: Kernel,
  provider: GasProvider
) {
  const proxyUrl = `${normalizeUrl(cfg.accountsUrl)}/api/v2/bundler/${opts.chainId}/${provider}`;
  const authed = authedFetch(cfg, opts.session);
  const proxyFetch = (input: string | URL | Request, init?: RequestInit) =>
    authed(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init);
  // retryCount 0: the SDK owns provider fallback; viem's silent retries (with backoff, also
  // on 429) would stall the caller before the next provider or the typed error.
  const proxyTransport = (timeout: number) => http(proxyUrl, { fetchFn: proxyFetch, retryCount: 0, timeout });
  const paymaster = createZeroDevPaymasterClient({
    chain,
    transport: proxyTransport(PROXY_TIMEOUT_MS),
  });
  const client = createKernelAccountClient({
    account,
    chain,
    client: publicClient,
    bundlerTransport: proxyTransport(PROXY_TIMEOUT_MS),
    paymaster: {
      // viem spreads whatever this returns into the UserOp before it is signed, so take
      // only paymaster and gas fields, and only a real sponsorship.
      getPaymasterData: async (userOperation) =>
        sponsorshipFields(cfg, opts.chainId, provider, await paymaster.sponsorUserOperation({ userOperation })),
    },
    userOperation: {
      estimateFeesPerGas: ({ bundlerClient }) => getUserOperationGasPrice(bundlerClient),
    },
  });
  // The send alone gets the longer timeout (SEND_TIMEOUT_MS).
  const sender = createBundlerClient({
    chain,
    transport: proxyTransport(SEND_TIMEOUT_MS),
  });
  return { client, sender };
}

/** The only UserOp fields a sponsorship may set. Never sender, nonce, callData, factory or factoryData. */
const SPONSOR_FIELDS = [
  "paymaster",
  "paymasterData",
  "paymasterVerificationGasLimit",
  "paymasterPostOpGasLimit",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
] as const;

type Sponsorship = {
  paymaster: Address;
  paymasterData: Hex;
} & Partial<Record<Exclude<(typeof SPONSOR_FIELDS)[number], "paymaster" | "paymasterData">, bigint>>;

/**
 * Keep only the paymaster and gas fields of a proxy sponsorship, and refuse (before
 * anything is signed) one without a non-zero paymaster: that UserOp would be unsponsored
 * and pay the proxy's chosen gas itself. A refusal moves on to the next provider.
 */
function sponsorshipFields(cfg: SdkConfig, chainId: number, provider: GasProvider, raw: unknown): Sponsorship {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pm = r.paymaster;
  if (typeof pm !== "string" || !isAddress(pm) || isAddressEqual(pm, zeroAddress)) {
    throw new SponsorshipError(
      "not_sponsored",
      provider,
      "the gas proxy returned no paymaster; refusing to sign an unsponsored UserOp"
    );
  }
  const allowed = cfg.allowedPaymasters?.[chainId];
  if (allowed && !allowed.some((a) => isAddressEqual(a, pm))) {
    throw new SponsorshipError(
      "paymaster_not_allowed",
      provider,
      `paymaster ${pm} is not in cfg.allowedPaymasters[${chainId}]`
    );
  }
  const data = r.paymasterData ?? "0x";
  if (typeof data !== "string" || !isHex(data)) {
    throw new SponsorshipError("not_sponsored", provider, "paymasterData is not hex");
  }
  const out: Record<string, unknown> = { paymaster: pm, paymasterData: data };
  for (const k of SPONSOR_FIELDS) {
    if (k === "paymaster" || k === "paymasterData") continue;
    const v = r[k];
    if (v === undefined) continue;
    if (typeof v !== "bigint" || v < 0n) {
      throw new SponsorshipError("not_sponsored", provider, `${k} is not a gas amount`);
    }
    out[k] = v;
  }
  return out as Sponsorship;
}

/** Wrap the signing methods so any failure surfaces as a SignerError, however viem wraps it. */
function guardSigner(account: LocalAccount): LocalAccount {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (e) {
        throw e instanceof SignerError ? e : new SignerError(e);
      }
    };
  return {
    ...account,
    signMessage: guard(account.signMessage.bind(account)),
    signTypedData: guard(account.signTypedData.bind(account)),
    signTransaction: guard(account.signTransaction.bind(account)),
    ...(account.sign ? { sign: guard(account.sign.bind(account)) } : {}),
  } as LocalAccount;
}

const FATAL_PROXY_STATUSES = [401, 403, 429] as const;

/**
 * Find an error that must not fall through to another provider anywhere in the cause
 * chain: a signer failure, a submitted UserOp, or the proxy refusing this session (HTTP
 * 401, 403 or 429, which would repeat on every provider; returned as a GasProxyError).
 */
function findFatal(e: unknown, provider: GasProvider): Error | undefined {
  for (let cur = e, i = 0; cur instanceof Error && i < 10; i++) {
    if (
      cur instanceof SignerError ||
      cur instanceof UserOperationPendingError ||
      cur instanceof UserOperationRevertedError ||
      cur instanceof UserOperationUnknownError ||
      cur instanceof GasProxyError
    )
      return cur;
    const http = cur as { name?: unknown; status?: unknown; headers?: unknown };
    if (http.name === "HttpRequestError" && FATAL_PROXY_STATUSES.some((s) => s === http.status)) {
      const status = http.status as 401 | 403 | 429;
      const retryAfter =
        status === 429 && http.headers instanceof Headers
          ? parseRetryAfter(http.headers.get("retry-after"))
          : undefined;
      return new GasProxyError(status, provider, retryAfter, { cause: cur });
    }
    cur = cur.cause;
  }
  return undefined;
}

/** One provider's proxy clients: `client` for everything, `sender` for the send only. */
type ProxyClients = ReturnType<typeof buildClients>;
type ProxyClient = ProxyClients["client"];

async function withProviders<T, Early extends string = never>(
  cfg: SdkConfig,
  opts: SmartAccountOptions,
  kernel: Kernel,
  run: (clients: ProxyClients, provider: GasProvider) => Promise<T>,
  /** Runs before each attempt; a defined result short-circuits (e.g. already deployed). */
  precheck?: () => Promise<{ result: T; provider: Early } | undefined>
): Promise<{ result: T; provider: GasProvider | Early }> {
  const providers = opts.providers?.length ? opts.providers : DEFAULT_PROVIDERS;
  const errors: unknown[] = [];
  for (const provider of providers) {
    const early = await precheck?.();
    if (early) return early;
    try {
      return {
        result: await run(buildClients(cfg, opts, kernel, provider), provider),
        provider,
      };
    } catch (e) {
      // Signer failures, sends with an unknown outcome and submitted-but-unconfirmed
      // UserOps must not fall through.
      const fatal = findFatal(e, provider);
      if (fatal) throw fatal;
      errors.push(e);
    }
  }
  throw new ProvidersExhaustedError(errors, providers);
}

/** JSON-RPC "internal error": the accounts proxy's upstream failure, or a bundler's own. */
const RPC_INTERNAL_ERROR = -32603;

/**
 * Did the provider definitely refuse the send? Only two failures count:
 * - a JSON-RPC error answer (viem's RpcRequestError) with a numeric code other than
 *   -32603 (internal error: the bundler or the proxy failed, which says nothing about
 *   whether the op was taken);
 * - an HTTP 4xx: the proxy refused before forwarding. 401, 403 and 429 then become
 *   GasProxyError in findFatal.
 * Everything else may have reached the bundler: HTTP 5xx, -32603, a JSON-RPC error
 * without a numeric code, an HttpRequestError without a status (fetch rejected, which is
 * also how a timeout arrives: viem aborts the fetch and send() wraps the AbortError in
 * NetworkError; or a 2xx body that could not be read or parsed), and any error not
 * recognised here.
 */
function isRefusedSend(e: unknown): boolean {
  for (let cur = e, i = 0; cur instanceof Error && i < 10; i++) {
    const x = cur as { name?: unknown; status?: unknown; code?: unknown };
    if (x.name === "HttpRequestError") return typeof x.status === "number" && x.status >= 400 && x.status < 500;
    if (x.name === "RpcRequestError") return typeof x.code === "number" && x.code !== RPC_INTERNAL_ERROR;
    cur = cur.cause;
  }
  return false;
}

/**
 * Ask the provider once whether it has the op: found only when the answer carries a
 * `userOperation`. Any other answer, or none, counts as no.
 */
async function knowsUserOperation(client: ProxyClient, hash: Hex): Promise<boolean> {
  try {
    const found: unknown = await client.request(
      { method: "eth_getUserOperationByHash", params: [hash] },
      { retryCount: 0 }
    );
    const op =
      typeof found === "object" && found !== null ? (found as { userOperation?: unknown }).userOperation : undefined;
    return typeof op === "object" && op !== null;
  } catch {
    return false;
  }
}

/**
 * One provider attempt: prepare (gas, sponsorship; the nonce is the call's, read once by
 * Kernel.nonce), sign, then send the signed op with eth_sendUserOperation. Returns the
 * op's hash, computed locally before the send.
 * A failure before the send, or a refusal of the send (isRefusedSend), throws for
 * withProviders to classify (usually: try the next provider). Any other send failure,
 * and a 2xx whose result is not the op's hash, is looked up once on the same provider by
 * hash; if it has the op the hash is returned, otherwise UserOperationUnknownError, which
 * never falls through.
 */
async function submitUserOperation(
  { client, sender }: ProxyClients,
  chainId: number,
  provider: GasProvider,
  calls: SendUserOperationOptions["calls"],
  nonce: Kernel["nonce"]
): Promise<Hex> {
  const { account } = client;
  const entryPointAddress = account.entryPoint.address;
  const prepared = (await client.prepareUserOperation({
    calls,
    nonce: await nonce(),
  })) as UserOperation<"0.7">;
  const signature = await account.signUserOperation({ ...prepared, chainId });
  const userOperation: UserOperation<"0.7"> = { ...prepared, signature };
  const hash = getUserOperationHash({
    userOperation,
    chainId,
    entryPointAddress,
    entryPointVersion: "0.7",
  });
  const unknownOutcome = async (cause: unknown): Promise<Hex> => {
    if (await knowsUserOperation(client, hash)) return hash;
    throw new UserOperationUnknownError(hash, provider, userOperation.nonce, cause);
  };
  // Built outside the try: only the request itself can leave the op's fate unknown.
  const rpcUserOperation = formatUserOperationRequest(userOperation);
  let result: unknown;
  try {
    result = await sender.request(
      {
        method: "eth_sendUserOperation",
        params: [rpcUserOperation, entryPointAddress],
      },
      { retryCount: 0 }
    );
  } catch (e) {
    if (isRefusedSend(e)) throw getUserOperationError(e as Error, { ...userOperation, calls });
    return unknownOutcome(e);
  }
  // A 2xx counts as accepted only when it names this op; null, none or another hash do not.
  if (typeof result === "string" && result.toLowerCase() === hash.toLowerCase()) return hash;
  return unknownOutcome(
    `eth_sendUserOperation returned ${JSON.stringify(result) ?? "no result"} instead of the op's hash`
  );
}

/**
 * The address of the plain kernel the wallet's UserOps are sent from (the one
 * deploySmartAccount deploys and sendUserOperation sends from), deployed or not.
 * Reads the configured RPC only; nothing is sent or signed.
 */
export async function smartAccountAddress(
  cfg: SdkConfig,
  opts: { walletViemAccount: LocalAccount; chainId: number }
): Promise<Hex> {
  const { publicClient } = publicClientFor(cfg, opts.chainId);
  const served = await publicClient.getChainId();
  if (served !== opts.chainId) {
    throw new UsageError("chain_mismatch", `cfg.rpcUrls[${opts.chainId}] serves chain ${served}`);
  }
  return (await plainKernelAccount(publicClient, opts.walletViemAccount)).address;
}

/**
 * Deploy the plain kernel for the wallet by sending a no-op UserOp, and wait for it
 * to be included. Returns without sending anything when the account already has code
 * (checked before every provider attempt). Sends the way sendUserOperation does, so a
 * send without a definite answer that the provider does not return is
 * UserOperationUnknownError.
 */
export async function deploySmartAccount(
  cfg: SdkConfig,
  opts: SmartAccountOptions
): Promise<{ address: `0x${string}`; provider: string }> {
  requireScopes(opts.session, ["write"], "deploying the smart account");
  const kernel = await kernelFor(cfg, opts);
  const { publicClient, account } = kernel;
  // Runs before every attempt, the first included: existing code means nothing is sent.
  const deployed = async () => {
    const c = await publicClient.getCode({ address: account.address });
    return c && c !== "0x" ? { result: account.address, provider: "none" as const } : undefined;
  };
  const { result, provider } = await withProviders(
    cfg,
    opts,
    kernel,
    async (clients, provider) => {
      const { client } = clients;
      // Fallback is only allowed until the op may have reached the bundler.
      const hash = await submitUserOperation(
        clients,
        opts.chainId,
        provider,
        [{ to: zeroAddress, value: 0n, data: "0x" }],
        kernel.nonce
      );
      await confirmUserOperation(
        (h) => client.request({ method: "eth_getUserOperationReceipt", params: [h] }, { retryCount: 0 }),
        hash,
        provider,
        opts.receiptTimeoutMs ?? 120_000
      );
      return client.account.address;
    },
    deployed
  );
  return { address: result, provider };
}

/**
 * Send a UserOp from the plain kernel. Each provider attempt prepares, signs and sends it.
 * A failure before the send, or a refusal of the send (a JSON-RPC error other than
 * -32603, or an HTTP 4xx), moves on to the next provider, which prepares and signs again
 * with the same nonce: the nonce is read once per call, so even a "refusal" whose op the
 * bundler took after all cannot run twice (the next op is then invalid on chain).
 * Returns the op's hash (computed locally) once the bundler accepts it; no receipt wait.
 * Any other send failure (a timeout, a network error, an unreadable body, HTTP 5xx,
 * -32603), and a 2xx whose result is not the op's hash, never moves on: the same provider
 * is asked once for the hash and, when it does not return the op,
 * UserOperationUnknownError is thrown. The op may still land: poll for that hash before
 * sending again. The send waits up to 30 s; every other proxy request waits 10 s.
 *
 * Deploy first with deploySmartAccount: this works on an undeployed kernel too, but
 * deploySmartAccount waits for the receipt and skips the UserOp when code exists.
 */
export async function sendUserOperation(
  cfg: SdkConfig,
  opts: SendUserOperationOptions
): Promise<{ userOpHash: Hex; provider: GasProvider }> {
  requireScopes(opts.session, ["write"], "sending a UserOperation");
  const kernel = await kernelFor(cfg, opts);
  const { result, provider } = await withProviders(cfg, opts, kernel, (clients, provider) =>
    submitUserOperation(clients, opts.chainId, provider, opts.calls, kernel.nonce)
  );
  return { userOpHash: result, provider };
}
