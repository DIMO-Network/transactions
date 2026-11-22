import { getKernelAddressFromECDSA } from "@zerodev/ecdsa-validator";
import { constants, KernelFactoryStakerAbi } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import {
  concatHex,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  getContractAddress,
  type Hex,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
import {
  entryPoint07Address,
  formatUserOperation,
  getUserOperationHash,
  type RpcUserOperation,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import { deploySmartAccount, sendUserOperation } from "../../../src/accounts/account/smart-account.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import type { Session } from "../../../src/accounts/auth/signin.js";
import type { SdkConfig } from "../../../src/accounts/config.js";
import {
  GasProxyError,
  ProvidersExhaustedError,
  SignerError,
  SponsorshipError,
  UsageError,
  UserOperationPendingError,
  UserOperationRevertedError,
  UserOperationUnknownError,
} from "../../../src/accounts/errors.js";
import { strictReceiver } from "../helpers.js";

const CHAIN_ID = 80002;
const PAYMASTER = "0x0000000000000000000000000000000000000abc";
const ACCOUNTS = "https://accounts.test";
const RPC = "https://rpc.test/polygon-amoy";
const wallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const sigAbi = parseAbi(["function getSenderAddress(bytes initCode)"]);
const nonceAbi = parseAbi(["function getNonce(address sender, uint192 key) view returns (uint256)"]);

/** Emulates the real kernel factory: address = CREATE2(factory, keccak(initData ++ salt), initCodeHash). */
function counterfactualFromCalldata(calldata: Hex): Hex {
  const { args } = decodeFunctionData({ abi: sigAbi, data: calldata });
  const initCode = args[0] as Hex;
  const metaFactoryCall = `0x${initCode.slice(42)}` as Hex;
  const { args: dwf } = decodeFunctionData({
    abi: KernelFactoryStakerAbi,
    data: metaFactoryCall,
  });
  const [factory, initData, salt] = dwf as [Hex, Hex, Hex];
  const impl = constants.KernelVersionToAddressesMap[KERNEL_V3_1].accountImplementationAddress;
  const initCodeHash = keccak256(
    concatHex([
      "0x603d3d8160223d3973",
      impl,
      "0x6009",
      "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076",
      "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3",
    ])
  );
  return getContractAddress({
    bytecodeHash: initCodeHash,
    opcode: "CREATE2",
    from: factory,
    salt: keccak256(concatHex([initData, salt])),
  });
}

interface Call {
  url: string;
  method: string;
  params: unknown[];
  headers: Headers;
}

type Sponsorship = Record<string, unknown>;

/** The hash a bundler computes for the op it received (what the SDK must report). */
const hashOf = (op: RpcUserOperation): Hex =>
  getUserOperationHash({
    userOperation: formatUserOperation(op),
    chainId: CHAIN_ID,
    entryPointAddress: entryPoint07Address,
    entryPointVersion: "0.7",
  });

function harness(
  opts: {
    failProviders?: string[];
    deployed?: boolean;
    /** Per provider: every proxy request answers this HTTP status (with headers). */
    proxyHttp?: Record<string, { status: number; headers?: HeadersInit }>;
    /** Per provider: rewrite the proxy's zd_sponsorUserOperation result. */
    sponsor?: Record<string, (s: Sponsorship) => Sponsorship>;
    /**
     * Per provider: eth_sendUserOperation fails with this HTTP status, a rejected fetch,
     * or a JSON-RPC error with this code. `kept`: the bundler took the op anyway, so
     * eth_getUserOperationByHash finds it.
     */
    sendFails?: Record<
      string,
      {
        status?: number;
        network?: true;
        rpcCode?: number;
        /** Answer the send with this response instead. */
        response?: () => Response;
        /** Never answer: the fetch rejects only when its signal aborts. */
        hang?: () => void;
        kept: boolean;
      }
    >;
    /** Per provider: rewrite eth_getUserOperationByHash's result. */
    lookup?: Record<string, (found: unknown) => unknown>;
    /** The chain id the RPC claims. Defaults to CHAIN_ID. */
    rpcChainId?: number;
    /**
     * What EntryPoint.getNonce returns. Defaults to key << 64. A function gets the number
     * of eth_sendUserOperation requests so far (to model an op landing between attempts).
     */
    chainNonce?: bigint | ((sends: number) => bigint);
  } = {}
) {
  const calls: Call[] = [];
  /** Every eth_sendUserOperation that reached a bundler, with the hash it computes. */
  const sent: {
    provider: string;
    userOp: Record<string, string>;
    hash: Hex;
  }[] = [];
  const known = new Set<Hex>();
  /** The key of every EntryPoint.getNonce read. */
  const nonceKeys: bigint[] = [];
  let sentSender: Hex | undefined;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const headers = new Headers(init?.headers);
    calls.push({ url, method: body.method, params: body.params, headers });
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const rpcErr = (code: number, message: string, data?: unknown) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code, message, data },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    if (url === RPC) {
      switch (body.method) {
        case "eth_chainId":
          return ok(toHex(opts.rpcChainId ?? CHAIN_ID));
        case "eth_getCode":
          return ok(opts.deployed ? "0x6001" : "0x");
        case "eth_call": {
          const data = body.params[0].data ?? body.params[0].input;
          if (String(data).startsWith("0x9b249f69")) {
            // EntryPoint.getSenderAddress -> reverts with SenderAddressResult(address)
            const addr = counterfactualFromCalldata(data);
            return rpcErr(
              3,
              "execution reverted",
              encodeErrorResult({
                abi: [
                  {
                    type: "error",
                    name: "SenderAddressResult",
                    inputs: [{ name: "sender", type: "address" }],
                  },
                ],
                errorName: "SenderAddressResult",
                args: [addr],
              })
            );
          }
          // EntryPoint.getNonce(sender, key) -> key << 64 | sequence 0, as the EntryPoint does.
          const { args: nonceArgs } = decodeFunctionData({
            abi: nonceAbi,
            data,
          });
          nonceKeys.push(nonceArgs[1]);
          const chainNonce = typeof opts.chainNonce === "function" ? opts.chainNonce(sent.length) : opts.chainNonce;
          return ok(encodeAbiParameters([{ type: "uint256" }], [chainNonce ?? nonceArgs[1] << 64n]));
        }
        default:
          return rpcErr(-32601, `unexpected chain method ${body.method}`);
      }
    }

    const m = url.match(/^https:\/\/accounts\.test\/api\/v2\/bundler\/(\d+)\/(\w+)$/);
    if (!m) throw new Error(`unexpected url ${url}`);
    const provider = m[2]!;
    const http = opts.proxyHttp?.[provider];
    if (http) {
      return new Response(JSON.stringify({ error: { code: "x", message: "m" } }), {
        status: http.status,
        headers: http.headers,
      });
    }
    if (opts.failProviders?.includes(provider) && body.method === "zd_sponsorUserOperation") {
      return rpcErr(-32000, `${provider} down`);
    }
    switch (body.method) {
      case "zd_getUserOperationGasPrice":
        return ok({
          slow: { maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1" },
          standard: { maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x1" },
          fast: { maxFeePerGas: "0x3", maxPriorityFeePerGas: "0x1" },
        });
      case "zd_sponsorUserOperation": {
        sentSender = body.params[0].userOp.sender;
        const base: Sponsorship = {
          callGasLimit: "0x10000",
          verificationGasLimit: "0x20000",
          preVerificationGas: "0x5000",
          paymaster: PAYMASTER,
          paymasterVerificationGasLimit: "0x8000",
          paymasterPostOpGasLimit: "0x8000",
          paymasterData: `0x${provider.length.toString(16).padStart(2, "0")}`,
        };
        return ok(opts.sponsor?.[provider]?.(base) ?? base);
      }
      case "eth_estimateUserOperationGas":
        return ok({
          callGasLimit: "0x10000",
          verificationGasLimit: "0x20000",
          preVerificationGas: "0x5000",
        });
      case "eth_sendUserOperation": {
        const hash = hashOf(body.params[0]);
        sent.push({ provider, userOp: body.params[0], hash });
        const fail = opts.sendFails?.[provider];
        if (fail?.kept !== false) known.add(hash);
        if (fail?.network) throw new TypeError("fetch failed");
        if (fail?.rpcCode) return rpcErr(fail.rpcCode, "upstream timeout");
        if (fail?.response) return fail.response();
        if (fail?.hang) return hangingFetch(init, fail.hang);
        if (fail?.status) {
          return new Response(JSON.stringify({ error: { code: "x", message: "m" } }), { status: fail.status });
        }
        return ok(hash);
      }
      case "eth_getUserOperationByHash": {
        const hash = body.params[0] as Hex;
        const op = sent.find((x) => x.hash === hash);
        const found =
          known.has(hash) && op
            ? {
                userOperation: op.userOp,
                entryPoint: entryPoint07Address,
                blockNumber: null,
                blockHash: null,
                transactionHash: null,
              }
            : null;
        const rewrite = opts.lookup?.[provider];
        return ok(rewrite ? rewrite(found) : found);
      }
      case "eth_getUserOperationReceipt":
        return ok({
          userOpHash: body.params[0],
          entryPoint: entryPoint07Address,
          sender: sentSender ?? zeroAddress,
          nonce: "0x0",
          actualGasUsed: "0x1",
          actualGasCost: "0x1",
          success: true,
          logs: [],
          receipt: {
            transactionHash: `0x${"cd".repeat(32)}`,
            transactionIndex: "0x0",
            blockHash: `0x${"ef".repeat(32)}`,
            blockNumber: "0x1",
            from: zeroAddress,
            to: zeroAddress,
            cumulativeGasUsed: "0x1",
            gasUsed: "0x1",
            contractAddress: null,
            logs: [],
            logsBloom: `0x${"00".repeat(256)}`,
            status: "0x1",
            effectiveGasPrice: "0x1",
            type: "0x2",
          },
        });
      default:
        return rpcErr(-32601, `unexpected bundler method ${body.method}`);
    }
  });
  const cfg: SdkConfig = {
    accountsUrl: ACCOUNTS,
    dauthUrl: "https://dauth.test",
    directoryUrl: "https://dir.test",
    turnkeyParentOrgId: "org",
    rpcUrls: { [CHAIN_ID]: RPC },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { cfg, calls, fetchImpl, sent, nonceKeys };
}

async function session(): Promise<Session> {
  return {
    did: "did:key:z",
    token: "tok",
    expiresAt: new Date(Date.now() + 60_000),
    dpopKey: await generateDpopKey(),
    scopes: ["read", "write"],
  };
}

function spySigner() {
  const signMessage = vi.fn(wallet.signMessage.bind(wallet));
  return { account: { ...wallet, signMessage } as typeof wallet, signMessage };
}

const noopCall = [{ to: zeroAddress, value: 0n, data: "0x" as Hex }];

/**
 * Record every setTimeout (still armed for real). viem arms a request's timeout just
 * before it calls fetch, so inside a fetch handler `timers.at(-1)` is that request's.
 */
function recordTimers() {
  const real = globalThis.setTimeout;
  const timers: { ms: number | undefined; fn: () => void }[] = [];
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
    timers.push({ ms, fn });
    return real(fn, ms);
  }) as unknown as typeof setTimeout);
  return { timers, restore: () => spy.mockRestore() };
}

/** A fetch that only settles when its signal aborts (then like a real fetch: AbortError). */
const hangingFetch = (init: RequestInit | undefined, onStart: () => void) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    onStart();
  });

/** An HTTP 200 carrying a JSON-RPC error, as the proxy and bundlers send them. */
const json200Error = (id: unknown, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const isProxy = (c: Call) => c.url.startsWith(`${ACCOUNTS}/api/v2/bundler/`);

describe("gas proxy failures that are per DID", () => {
  const run = async (h: ReturnType<typeof harness>, over: { scopes?: string[] } = {}) => {
    const { account, signMessage } = spySigner();
    const sess = {
      ...(await session()),
      ...(over.scopes ? { scopes: over.scopes } : {}),
    };
    const err = await sendUserOperation(h.cfg, {
      session: sess,
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
      providers: ["alchemy", "gelato", "pimlico"],
    }).catch((e: unknown) => e);
    return { err, signMessage };
  };

  it.each([
    [401, "proxy_unauthorized"],
    [403, "proxy_forbidden"],
  ])("HTTP %i is fatal: no next provider, nothing signed", async (status, code) => {
    const h = harness({ proxyHttp: { alchemy: { status } } });
    const { err, signMessage } = await run(h);
    expect(err).toBeInstanceOf(GasProxyError);
    expect(err).toMatchObject({ code, status, provider: "alchemy" });
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("HTTP 429 is a typed error with Retry-After, sent once (no viem retries)", async () => {
    const h = harness({
      proxyHttp: { alchemy: { status: 429, headers: { "Retry-After": "7" } } },
    });
    const { err } = await run(h);
    expect(err).toBeInstanceOf(GasProxyError);
    expect(err).toMatchObject({
      code: "proxy_rate_limited",
      status: 429,
      retryAfterSeconds: 7,
    });
    expect(h.calls.filter(isProxy)).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("a 429 without an integer Retry-After has no retryAfterSeconds", async () => {
    const h = harness({
      proxyHttp: {
        alchemy: {
          status: 429,
          headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
        },
      },
    });
    const { err } = await run(h);
    expect((err as GasProxyError).retryAfterSeconds).toBeUndefined();
  });

  it("a 5xx still falls through to the next provider, after one request (no retries)", async () => {
    const h = harness({ proxyHttp: { alchemy: { status: 503 } } });
    const { err } = await run(h);
    expect(err).not.toBeInstanceOf(Error);
    const proxy = h.calls.filter(isProxy);
    expect(proxy.filter((c) => c.url.endsWith("/alchemy"))).toHaveLength(1);
    expect(proxy.some((c) => c.url.endsWith("/gelato"))).toBe(true);
  });

  it("sendUserOperation and deploySmartAccount need scope write before any request", async () => {
    const h = harness();
    const { err } = await run(h, { scopes: ["read"] });
    expect(err).toMatchObject({ name: "UsageError", code: "scope_missing" });
    const { account } = spySigner();
    const e2 = await deploySmartAccount(h.cfg, {
      session: { ...(await session()), scopes: ["read"] },
      walletViemAccount: account,
      chainId: CHAIN_ID,
    }).catch((e: unknown) => e);
    expect(e2).toMatchObject({ name: "UsageError", code: "scope_missing" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("ProvidersExhaustedError's message includes each provider's HTTP status", () => {
    const e = Object.assign(new Error("HTTP request failed."), {
      name: "HttpRequestError",
      status: 503,
    });
    expect(new ProvidersExhaustedError([e], ["alchemy"]).message).toContain(
      "HttpRequestError: HTTP request failed. (HTTP 503)"
    );
  });
});

describe("smart account through the gas proxy", () => {
  it("bundler transport points at the accounts proxy with DPoP headers", async () => {
    const { cfg, calls, sent } = harness();
    const { account } = spySigner();
    const r = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
    });
    expect(r.provider).toBe("alchemy");
    expect(r.userOpHash).toBe(sent[0]!.hash);
    const proxy = calls.filter(isProxy);
    expect(proxy.length).toBeGreaterThan(0);
    for (const c of proxy) {
      expect(c.url).toBe(`${ACCOUNTS}/api/v2/bundler/${CHAIN_ID}/alchemy`);
      expect(c.headers.get("authorization")).toBe("DPoP tok");
      expect(c.headers.get("dpop")).toBeTruthy();
    }
    // report the methods the flow sends through the proxy
    expect([...new Set(proxy.map((c) => c.method))].sort()).toMatchInlineSnapshot(`
      [
        "eth_sendUserOperation",
        "zd_getUserOperationGasPrice",
        "zd_sponsorUserOperation",
      ]
    `);
  });

  it("falls through to the next provider when sponsorship fails before signing", async () => {
    const { cfg, calls } = harness({ failProviders: ["alchemy", "gelato"] });
    const { account, signMessage } = spySigner();
    const r = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
      providers: ["alchemy", "gelato", "pimlico"],
    });
    expect(r.provider).toBe("pimlico");
    const urls = calls.filter(isProxy).map((c) => c.url);
    expect(urls.some((u) => u.endsWith("/alchemy"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/gelato"))).toBe(true);
    expect(urls.at(-1)).toMatch(/\/pimlico$/);
    // Only the pimlico attempt got as far as signing: sponsorship failed before signing on the others.
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("a provider failure after signing rebuilds and re-signs with the next provider", async () => {
    const { cfg, calls } = harness();
    // gelato accepts sponsorship but rejects the send
    const base = cfg.fetchImpl!;
    cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      if (String(u).endsWith("/gelato") && body.method === "eth_sendUserOperation") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: "gelato send failed" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return base(u, i);
    }) as typeof fetch;
    const { account, signMessage } = spySigner();
    const r = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
      providers: ["gelato", "pimlico"],
    });
    expect(r.provider).toBe("pimlico");
    expect(signMessage).toHaveBeenCalledTimes(2);
    const proxyUrls = calls.filter(isProxy).map((c) => c.url);
    expect(proxyUrls.at(-1)).toMatch(/\/pimlico$/);
    // A JSON-RPC error is an answer: nothing to look up.
    expect(calls.some((c) => c.method === "eth_getUserOperationByHash")).toBe(false);
  });

  it("throws when every provider fails", async () => {
    const { cfg } = harness({
      failProviders: ["alchemy", "gelato", "pimlico"],
    });
    const { account } = spySigner();
    await expect(
      sendUserOperation(cfg, {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
      })
    ).rejects.toThrow();
  });

  it("chain reads go to cfg.rpcUrls, never to the proxy", async () => {
    const { cfg, calls } = harness();
    const { account } = spySigner();
    await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
    });
    const chainMethods = new Set(["eth_call", "eth_getCode", "eth_chainId", "eth_getTransactionCount"]);
    expect(calls.some((c) => c.url === RPC && c.method === "eth_call")).toBe(true);
    for (const c of calls.filter(isProxy)) {
      expect(chainMethods.has(c.method)).toBe(false);
    }
    // chain reads carry no DPoP credentials
    for (const c of calls.filter((c) => c.url === RPC)) {
      expect(c.headers.get("authorization")).toBeNull();
    }
  });

  it("the deployed address equals the plain-kernel counterfactual address", async () => {
    const { cfg, calls } = harness();
    const { account } = spySigner();
    const r = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
    });
    const expected = await getKernelAddressFromECDSA({
      entryPoint: getEntryPoint("0.7"),
      kernelVersion: KERNEL_V3_1,
      eoaAddress: wallet.address,
      index: 0n,
      initCodeHash: keccak256(
        concatHex([
          "0x603d3d8160223d3973",
          constants.KernelVersionToAddressesMap[KERNEL_V3_1].accountImplementationAddress,
          "0x6009",
          "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076",
          "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3",
        ])
      ),
    });
    expect(r.address.toLowerCase()).toBe(expected.toLowerCase());
    expect(r.provider).toBe("alchemy");
    expect([...new Set(calls.filter(isProxy).map((c) => c.method))].sort()).toEqual([
      "eth_getUserOperationReceipt",
      "eth_sendUserOperation",
      "zd_getUserOperationGasPrice",
      "zd_sponsorUserOperation",
    ]);
  });

  it("deploySmartAccount skips the UserOp when code already exists", async () => {
    const { cfg, calls } = harness({ deployed: true });
    const { account } = spySigner();
    const r = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
    });
    expect(r.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(calls.filter(isProxy)).toHaveLength(0);
  });

  it("a signer failure aborts: one sign call, no further provider, error surfaces", async () => {
    const { cfg, calls } = harness();
    const signMessage = vi.fn(async () => {
      throw new Error("user cancelled");
    });
    const account = { ...wallet, signMessage } as typeof wallet;
    const err = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
      providers: ["alchemy", "gelato", "pimlico"],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignerError);
    expect((err as Error).message).toContain("user cancelled");
    expect(signMessage).toHaveBeenCalledTimes(1);
    const urls = calls.filter(isProxy).map((c) => c.url);
    expect(urls.every((u) => u.endsWith("/alchemy"))).toBe(true);
  });

  it("a receipt timeout after a successful send never resubmits and carries the hash", async () => {
    const { cfg, calls, sent } = harness();
    const base = cfg.fetchImpl!;
    cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      if (body.method === "eth_getUserOperationReceipt") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return base(u, i);
    }) as typeof fetch;
    const { account } = spySigner();
    const err = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
      receiptTimeoutMs: 50,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserOperationPendingError);
    expect((err as UserOperationPendingError).userOpHash).toBe(sent[0]!.hash);
    expect((err as UserOperationPendingError).provider).toBe("alchemy");
    expect(calls.filter((c) => c.method === "eth_sendUserOperation")).toHaveLength(1);
  });

  it("returns early when code appears between provider attempts", async () => {
    const { cfg, calls } = harness({ failProviders: ["alchemy"] });
    const base = cfg.fetchImpl!;
    let codeReads = 0;
    cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      if (body.method === "eth_getCode") {
        codeReads++;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: codeReads >= 3 ? "0x6001" : "0x",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return base(u, i);
    }) as typeof fetch;
    const { account } = spySigner();
    const r = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    });
    expect(r.provider).toBe("none");
    expect(calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("when every provider fails, the error keeps each provider's error", async () => {
    const { cfg } = harness({
      failProviders: ["alchemy", "gelato", "pimlico"],
    });
    const { account } = spySigner();
    const err = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProvidersExhaustedError);
    expect((err as ProvidersExhaustedError).code).toBe("providers_exhausted");
    expect((err as ProvidersExhaustedError).errors).toHaveLength(3);
  });

  it("the message names each provider's error but never leaks a URL; .errors keeps the originals", () => {
    const raw = new Error("HTTP request failed. URL: https://rpc.example/v2/SECRETKEY?x=1 Details: boom");
    raw.name = "HttpRequestError";
    const err = new ProvidersExhaustedError([raw, "plain failure"], ["alchemy", "gelato"]);
    expect(err.message).not.toContain("SECRETKEY");
    expect(err.message).not.toContain("rpc.example");
    expect(err.message).toContain("alchemy: HttpRequestError");
    expect(err.message).toContain("<url>");
    expect(err.message).toContain("gelato: plain failure");
    expect(err.errors[0]).toBe(raw);
    expect((err.errors[0] as Error).message).toContain("SECRETKEY");
  });
  it("calls cfg.fetchImpl unbound for the RPC and the proxy", async () => {
    const { cfg } = harness();
    cfg.fetchImpl = strictReceiver(cfg.fetchImpl!);
    const { account } = spySigner();
    const r = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
    });
    expect(r.provider).toBe("alchemy");
  });

  it("a missing rpcUrl is a UsageError", async () => {
    const { cfg } = harness();
    const { account } = spySigner();
    const e = await sendUserOperation(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: 1,
      calls: noopCall,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as UsageError).code).toBe("rpc_url_missing");
  });

  it("a reverted deploy receipt is UserOperationRevertedError, final: no other provider", async () => {
    const { cfg, calls } = harness();
    const base = cfg.fetchImpl!;
    cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      const res = await base(u, i);
      if (body.method !== "eth_getUserOperationReceipt") return res;
      const j = await res.json();
      j.result.success = false;
      j.result.reason = "AA23 reverted";
      return new Response(JSON.stringify(j), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const { account } = spySigner();
    const err = await deploySmartAccount(cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserOperationRevertedError);
    expect((err as UserOperationRevertedError).reason).toBe("AA23 reverted");
    expect((err as UserOperationRevertedError).provider).toBe("alchemy");
    expect(calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });
  describe("never signs an unsponsored or proxy-shaped UserOp", () => {
    const causes = (e: unknown): unknown[] => {
      const out: unknown[] = [];
      for (let c = e, i = 0; c instanceof Error && i < 10; i++) {
        out.push(c);
        c = c.cause;
      }
      return out;
    };
    const sponsorshipCode = (e: unknown) =>
      (causes(e).find((c) => c instanceof SponsorshipError) as SponsorshipError | undefined)?.code;
    const drop =
      (...keys: string[]) =>
      (s: Sponsorship) =>
        Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k)));

    it("no paymaster from one provider: nothing signed for it, the next provider is used", async () => {
      const { cfg, calls, sent } = harness({
        sponsor: { alchemy: drop("paymaster", "paymasterData") },
      });
      const { account, signMessage } = spySigner();
      const r = await sendUserOperation(cfg, {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
        providers: ["alchemy", "gelato"],
      });
      expect(r.provider).toBe("gelato");
      expect(signMessage).toHaveBeenCalledTimes(1);
      expect(sent.map((x) => x.provider)).toEqual(["gelato"]);
      expect(sent[0]!.userOp.paymaster).toBe(PAYMASTER);
      expect(calls.filter((c) => c.url.endsWith("/alchemy")).map((c) => c.method)).not.toContain(
        "eth_sendUserOperation"
      );
    });

    it.each([
      ["no paymaster", drop("paymaster")],
      ["a zero paymaster", (s: Sponsorship) => ({ ...s, paymaster: zeroAddress })],
      ["a malformed paymaster", (s: Sponsorship) => ({ ...s, paymaster: "0x12" })],
    ])("%s from every provider: ProvidersExhaustedError, never signed", async (_n, rewrite) => {
      const { cfg, sent } = harness({
        sponsor: { alchemy: rewrite, gelato: rewrite, pimlico: rewrite },
      });
      const { account, signMessage } = spySigner();
      const err = await sendUserOperation(cfg, {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProvidersExhaustedError);
      const errors = (err as ProvidersExhaustedError).errors;
      expect(errors).toHaveLength(3);
      for (const e of errors) expect(sponsorshipCode(e)).toBe("not_sponsored");
      expect(signMessage).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it("takes only paymaster and gas fields from the proxy: sender, nonce, callData and factory stay the SDK's", async () => {
      const evil = "0x000000000000000000000000000000000000dead";
      const hostile = (s: Sponsorship) => ({
        ...s,
        sender: evil,
        nonce: "0x99",
        callData: "0xdeadbeef",
        factory: evil,
        factoryData: "0xdeadbeef",
        signature: "0x01",
      });
      const honest = harness();
      const { account } = spySigner();
      const base = {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
      };
      await sendUserOperation(honest.cfg, base);
      const { cfg, sent } = harness({ sponsor: { alchemy: hostile } });
      await sendUserOperation(cfg, base);
      const [want, got] = [honest.sent[0]!.userOp, sent[0]!.userOp];
      for (const k of ["sender", "nonce", "callData", "factory", "factoryData"]) {
        expect(got[k], k).toBe(want[k]);
      }
      expect(got.sender).not.toBe(evil);
      expect(got.paymaster).toBe(PAYMASTER);
    });

    it("cfg.allowedPaymasters refuses any other paymaster before signing", async () => {
      const { cfg, sent } = harness();
      cfg.allowedPaymasters = {
        [CHAIN_ID]: ["0x0000000000000000000000000000000000000def"],
      };
      const { account, signMessage } = spySigner();
      const err = await sendUserOperation(cfg, {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProvidersExhaustedError);
      for (const e of (err as ProvidersExhaustedError).errors) expect(sponsorshipCode(e)).toBe("paymaster_not_allowed");
      expect(signMessage).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);

      cfg.allowedPaymasters = { [CHAIN_ID]: [PAYMASTER] };
      const ok = await sendUserOperation(cfg, {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
        calls: noopCall,
      });
      expect(ok.provider).toBe("alchemy");
    });
  });
});

describe("a send without an answer is never sent again elsewhere", () => {
  const lookups = (calls: Call[]) => calls.filter((c) => c.method === "eth_getUserOperationByHash");
  const send = async (
    h: ReturnType<typeof harness>,
    providers: ("alchemy" | "gelato" | "pimlico")[] = ["alchemy", "gelato"]
  ) => {
    const { account, signMessage } = spySigner();
    const out = await sendUserOperation(h.cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      calls: noopCall,
      providers,
    }).catch((e: unknown) => e);
    return { out, signMessage };
  };

  it("a 502 after the send, and the provider has the hash: returns it, no second provider", async () => {
    const h = harness({ sendFails: { alchemy: { status: 502, kept: true } } });
    const { out, signMessage } = await send(h);
    expect(out).toEqual({ userOpHash: h.sent[0]!.hash, provider: "alchemy" });
    expect(h.sent).toHaveLength(1);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(lookups(h.calls).map((c) => c.url)).toEqual([`${ACCOUNTS}/api/v2/bundler/${CHAIN_ID}/alchemy`]);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("a 502 after the send, and the hash is unknown: UserOperationUnknownError, no fall-through", async () => {
    const h = harness({ sendFails: { alchemy: { status: 502, kept: false } } });
    const { out, signMessage } = await send(h);
    expect(out).toBeInstanceOf(UserOperationUnknownError);
    const err = out as UserOperationUnknownError;
    expect(err).toMatchObject({
      code: "user_operation_unknown",
      userOpHash: h.sent[0]!.hash,
      provider: "alchemy",
    });
    expect(err.cause).toMatchObject({ name: "HttpRequestError", status: 502 });
    expect(err.message).not.toContain("accounts.test");
    expect(lookups(h.calls)).toHaveLength(1);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("fetch rejecting on the send is ambiguous too", async () => {
    const h = harness({
      sendFails: { alchemy: { network: true, kept: false } },
    });
    const { out } = await send(h);
    expect(out).toBeInstanceOf(UserOperationUnknownError);
    expect(lookups(h.calls)).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("a paymaster error before the send still falls through, with no hash lookup", async () => {
    const h = harness();
    const base = h.cfg.fetchImpl!;
    h.cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      if (String(u).endsWith("/alchemy") && body.method === "zd_sponsorUserOperation") {
        return new Response(JSON.stringify({ error: { code: "x", message: "m" } }), { status: 502 });
      }
      return base(u, i);
    }) as typeof fetch;
    const { out, signMessage } = await send(h);
    expect(out).toMatchObject({ provider: "gelato" });
    expect(h.sent.map((x) => x.provider)).toEqual(["gelato"]);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(lookups(h.calls)).toHaveLength(0);
  });

  it("JSON-RPC -32603 answering the send, and the provider has the hash: returns it, no second provider", async () => {
    const h = harness({
      sendFails: { alchemy: { rpcCode: -32603, kept: true } },
    });
    const { out, signMessage } = await send(h);
    expect(out).toEqual({ userOpHash: h.sent[0]!.hash, provider: "alchemy" });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(lookups(h.calls)).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("JSON-RPC -32603 answering the send, and the hash is unknown: UserOperationUnknownError", async () => {
    const h = harness({
      sendFails: { alchemy: { rpcCode: -32603, kept: false } },
    });
    const { out } = await send(h);
    expect(out).toBeInstanceOf(UserOperationUnknownError);
    expect(out).toMatchObject({
      userOpHash: h.sent[0]!.hash,
      provider: "alchemy",
    });
    expect((out as Error).cause).toMatchObject({ code: -32603 });
    expect(lookups(h.calls)).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it.each([-32000, -32602, -32500, -32521])(
    "JSON-RPC %i answering the send is a refusal: falls through, no lookup",
    async (rpcCode) => {
      const h = harness({
        sendFails: { alchemy: { rpcCode, kept: false } },
      });
      const { out, signMessage } = await send(h);
      expect(out).toMatchObject({ provider: "gelato" });
      expect(signMessage).toHaveBeenCalledTimes(2);
      expect(lookups(h.calls)).toHaveLength(0);
    }
  );

  it("JSON-RPC -32603 before the send (sponsorship) still falls through, no lookup", async () => {
    const h = harness();
    const base = h.cfg.fetchImpl!;
    h.cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      const body = JSON.parse(String(i?.body ?? "{}"));
      if (String(u).endsWith("/alchemy") && body.method === "zd_sponsorUserOperation") {
        return json200Error(body.id, -32603, "upstream timeout");
      }
      return base(u, i);
    }) as typeof fetch;
    const { out } = await send(h);
    expect(out).toMatchObject({ provider: "gelato" });
    expect(h.sent.map((x) => x.provider)).toEqual(["gelato"]);
    expect(lookups(h.calls)).toHaveLength(0);
  });

  /** The send failed in a way that may have reached the bundler: looked up, never sent elsewhere. */
  const expectAmbiguous = (h: ReturnType<typeof harness>, out: unknown) => {
    expect(out).toBeInstanceOf(UserOperationUnknownError);
    expect(out).toMatchObject({
      userOpHash: h.sent[0]!.hash,
      provider: "alchemy",
    });
    expect(lookups(h.calls)).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  };

  it("a 200 whose body is not JSON is ambiguous", async () => {
    const h = harness({
      sendFails: {
        alchemy: {
          kept: false,
          response: () =>
            new Response("<html>bad gateway</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        },
      },
    });
    const { out } = await send(h);
    expectAmbiguous(h, out);
    expect((out as Error).cause).toMatchObject({ name: "HttpRequestError" });
    expect(((out as Error).cause as { status?: unknown }).status).toBe(undefined);
  });

  it("a body stream that errors mid-read is ambiguous", async () => {
    const h = harness({
      sendFails: {
        alchemy: {
          kept: false,
          response: () => {
            let pulls = 0;
            return new Response(
              new ReadableStream<Uint8Array>({
                pull(c) {
                  if (pulls++ === 0) c.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",'));
                  else c.error(new TypeError("terminated"));
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
      },
    });
    const { out } = await send(h);
    expectAmbiguous(h, out);
  });

  it("a JSON-RPC error without a numeric code is ambiguous", async () => {
    const h = harness({
      sendFails: {
        alchemy: {
          kept: false,
          response: () => json200Error(1, "boom" as unknown as number, "x"),
        },
      },
    });
    const { out } = await send(h);
    expectAmbiguous(h, out);
  });

  it("the send times out after 30 s, and that timeout is ambiguous", async () => {
    const { timers, restore } = recordTimers();
    try {
      let sendTimeout: number | undefined;
      const h = harness({
        sendFails: {
          alchemy: {
            kept: true,
            hang: () => {
              // viem armed this request's timer just before calling fetch: fire it now.
              const t = timers.at(-1)!;
              sendTimeout = t.ms;
              t.fn();
            },
          },
        },
      });
      const { out } = await send(h);
      expect(sendTimeout).toBe(30_000);
      expect(out).toEqual({
        userOpHash: h.sent[0]!.hash,
        provider: "alchemy",
      });
      expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
    } finally {
      restore();
    }
  });

  it("only the send waits 30 s: sponsorship, gas price and the lookup keep 10 s", async () => {
    const { timers, restore } = recordTimers();
    try {
      const h = harness({
        sendFails: { alchemy: { status: 502, kept: true } },
      });
      const base = h.cfg.fetchImpl!;
      const armed = new Map<string, Set<number | undefined>>();
      h.cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
        if (String(u).startsWith(`${ACCOUNTS}/api/v2/bundler/`)) {
          const method = JSON.parse(String(i?.body)).method as string;
          armed.set(method, (armed.get(method) ?? new Set()).add(timers.at(-1)?.ms));
        }
        return base(u, i);
      }) as typeof fetch;
      const { out } = await send(h);
      expect(out).toMatchObject({ provider: "alchemy" });
      expect(Object.fromEntries([...armed].map(([m, v]) => [m, [...v]]))).toEqual({
        zd_getUserOperationGasPrice: [10_000],
        zd_sponsorUserOperation: [10_000],
        eth_sendUserOperation: [30_000],
        eth_getUserOperationByHash: [10_000],
      });
    } finally {
      restore();
    }
  });

  it("a hung sponsorship call times out after 10 s and falls through", async () => {
    const { timers, restore } = recordTimers();
    try {
      const h = harness();
      const base = h.cfg.fetchImpl!;
      let sponsorTimeout: number | undefined;
      h.cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
        const method = JSON.parse(String(i?.body ?? "{}")).method;
        if (String(u).endsWith("/alchemy") && method === "zd_sponsorUserOperation") {
          return hangingFetch(i, () => {
            const t = timers.at(-1)!;
            sponsorTimeout = t.ms;
            t.fn();
          });
        }
        return base(u, i);
      }) as typeof fetch;
      const { out } = await send(h);
      expect(sponsorTimeout).toBe(10_000);
      expect(out).toMatchObject({ provider: "gelato" });
      expect(h.sent.map((x) => x.provider)).toEqual(["gelato"]);
      expect(lookups(h.calls)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  describe("a 2xx whose result is not the op's hash is not success", () => {
    const answers: [string, (hash: Hex) => string][] = [
      ["a null result", () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })],
      ["no result", () => JSON.stringify({ jsonrpc: "2.0", id: 1 })],
      [
        "another hash",
        () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${"cd".repeat(32)}`,
          }),
      ],
    ];
    const answering = (body: (hash: Hex) => string, kept: boolean) => {
      const h: ReturnType<typeof harness> = harness({
        sendFails: {
          alchemy: {
            kept,
            response: () =>
              new Response(body(h.sent.at(-1)!.hash), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
          },
        },
      });
      return h;
    };

    it.each(answers)("%s, and the provider has the op: the hash, after one lookup", async (_n, body) => {
      const h = answering(body, true);
      const { out } = await send(h);
      expect(out).toEqual({
        userOpHash: h.sent[0]!.hash,
        provider: "alchemy",
      });
      expect(lookups(h.calls)).toHaveLength(1);
      expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
    });

    it.each(answers)("%s, and the provider does not have it: UserOperationUnknownError", async (_n, body) => {
      const h = answering(body, false);
      const { out } = await send(h);
      expectAmbiguous(h, out);
      expect((out as Error).message).toContain("instead of the op's hash");
    });

    it("the hash in upper case is the same hash: success, no lookup", async () => {
      const h = answering(
        (hash) =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: `0x${hash.slice(2).toUpperCase()}`,
          }),
        true
      );
      const { out } = await send(h);
      expect(out).toEqual({
        userOpHash: h.sent[0]!.hash,
        provider: "alchemy",
      });
      expect(lookups(h.calls)).toHaveLength(0);
    });
  });

  it("a lookup answer without userOperation is not found", async () => {
    const h = harness({
      sendFails: { alchemy: { status: 502, kept: true } },
      lookup: {
        alchemy: () => ({ entryPoint: entryPoint07Address, blockHash: null }),
      },
    });
    const { out } = await send(h);
    expectAmbiguous(h, out);
  });

  it("UserOperationUnknownError carries the op's nonce", async () => {
    const h = harness({
      sendFails: { alchemy: { status: 502, kept: false } },
      chainNonce: (5n << 64n) | 3n,
    });
    const { out } = await send(h);
    expect((out as UserOperationUnknownError).nonce).toBe((5n << 64n) | 3n);
    expect((out as UserOperationUnknownError).nonce).toBe(BigInt(h.sent[0]!.userOp.nonce!));
  });

  it("every attempt reads the same nonce key, so two attempts cannot both land", async () => {
    const h = harness({
      sendFails: { alchemy: { rpcCode: -32000, kept: false } },
    });
    const { out } = await send(h);
    expect(out).toMatchObject({ provider: "gelato" });
    expect(h.sent.map((x) => x.provider)).toEqual(["alchemy", "gelato"]);
    expect(new Set(h.nonceKeys).size).toBe(1);
    expect(h.sent[1]!.userOp.nonce).toBe(h.sent[0]!.userOp.nonce);
  });

  it("reads the nonce once per call: a refused send that landed anyway cannot run twice (R6-F2)", async () => {
    // alchemy's bundler took the op but answered a JSON-RPC error (classified as a refusal),
    // and the op was mined before gelato prepared: the chain nonce has moved on.
    const h = harness({
      sendFails: { alchemy: { rpcCode: -32000, kept: true } },
      chainNonce: (sends) => BigInt(sends),
    });
    const { out } = await send(h);
    expect(out).toMatchObject({ provider: "gelato" });
    expect(h.sent.map((x) => x.provider)).toEqual(["alchemy", "gelato"]);
    // Both attempts signed the nonce read before the first one, so at most one can land.
    expect(h.sent[1]!.userOp.nonce).toBe(h.sent[0]!.userOp.nonce);
    expect(BigInt(h.sent[0]!.userOp.nonce!)).toBe(0n);
    expect(h.nonceKeys).toHaveLength(1);
  });

  it("deploy reads the nonce once across provider attempts too (R6-F2)", async () => {
    const h = harness({
      sendFails: { alchemy: { rpcCode: -32000, kept: true } },
      chainNonce: (sends) => BigInt(sends),
    });
    const { account } = spySigner();
    const r = await deploySmartAccount(h.cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    });
    expect(r.provider).toBe("gelato");
    expect(h.sent[1]!.userOp.nonce).toBe(h.sent[0]!.userOp.nonce);
    expect(h.nonceKeys).toHaveLength(1);
  });

  it.each(["send", "deploy"] as const)(
    "%s: an RPC serving another chain is UsageError chain_mismatch, before any signing",
    async (which) => {
      const h = harness({ rpcChainId: 137 });
      const { account, signMessage } = spySigner();
      const base = {
        session: await session(),
        walletViemAccount: account,
        chainId: CHAIN_ID,
      };
      const err = await (
        which === "send" ? sendUserOperation(h.cfg, { ...base, calls: noopCall }) : deploySmartAccount(h.cfg, base)
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UsageError);
      expect(err).toMatchObject({ code: "chain_mismatch" });
      expect(signMessage).not.toHaveBeenCalled();
      expect(h.calls.filter(isProxy)).toHaveLength(0);
    }
  );

  it("a 400 answering the send is a refusal: falls through, no lookup", async () => {
    const h = harness({ sendFails: { alchemy: { status: 400, kept: false } } });
    const { out } = await send(h);
    expect(out).toMatchObject({ provider: "gelato" });
    expect(lookups(h.calls)).toHaveLength(0);
  });

  it.each([
    [401, "proxy_unauthorized"],
    [403, "proxy_forbidden"],
    [429, "proxy_rate_limited"],
  ])("HTTP %i answering the send is still GasProxyError: no lookup, no next provider", async (status, code) => {
    const h = harness({ sendFails: { alchemy: { status, kept: false } } });
    const { out } = await send(h);
    expect(out).toBeInstanceOf(GasProxyError);
    expect(out).toMatchObject({ code, status, provider: "alchemy" });
    expect(lookups(h.calls)).toHaveLength(0);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("deploySmartAccount: a 502 the provider knows waits for that hash's receipt", async () => {
    const h = harness({ sendFails: { alchemy: { status: 502, kept: true } } });
    const { account } = spySigner();
    const r = await deploySmartAccount(h.cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    });
    expect(r.provider).toBe("alchemy");
    const receipts = h.calls.filter((c) => c.method === "eth_getUserOperationReceipt");
    expect(receipts.length).toBeGreaterThan(0);
    expect(h.sent).toHaveLength(1);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
  });

  it("deploySmartAccount: a 502 the provider does not know is UserOperationUnknownError", async () => {
    const h = harness({ sendFails: { alchemy: { status: 502, kept: false } } });
    const { account } = spySigner();
    const err = await deploySmartAccount(h.cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserOperationUnknownError);
    expect((err as UserOperationUnknownError).userOpHash).toBe(h.sent[0]!.hash);
    expect(h.calls.some((c) => c.url.endsWith("/gelato"))).toBe(false);
    expect(h.calls.some((c) => c.method === "eth_getUserOperationReceipt")).toBe(false);
  });

  it("deploySmartAccount builds the kernel once, not once per provider", async () => {
    const h = harness({ failProviders: ["alchemy"] });
    const { account } = spySigner();
    const r = await deploySmartAccount(h.cfg, {
      session: await session(),
      walletViemAccount: account,
      chainId: CHAIN_ID,
      providers: ["alchemy", "gelato"],
    });
    expect(r.provider).toBe("gelato");
    // The kernel's address comes from EntryPoint.getSenderAddress.
    const getSenderAddress = h.calls.filter(
      (c) =>
        c.url === RPC &&
        c.method === "eth_call" &&
        String((c.params?.[0] as { data?: string })?.data).startsWith("0x9b249f69")
    );
    expect(getSenderAddress).toHaveLength(1);
  });
});
