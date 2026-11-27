import { type Hex, http, isHex } from "viem";
import { createBundlerClient } from "viem/account-abstraction";

import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import { UsageError, UserOperationPendingError, UserOperationRevertedError } from "../errors.js";

/** One receipt request waits this long, like every proxy request but the send. */
const RECEIPT_REQUEST_TIMEOUT_MS = 10_000;
const POLLING_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/** One `eth_getUserOperationReceipt` request: resolves null while the op is not included. */
type ReceiptRequest = (hash: Hex) => Promise<unknown>;

/** HTTP statuses that retrying cannot fix: the session is refused or lacks the scope. */
const FATAL_STATUSES = [401, 403];

function isAuthRefusal(e: unknown): boolean {
  for (let cur = e, i = 0; cur instanceof Error && i < 10; i++) {
    const x = cur as { name?: unknown; status?: unknown };
    if (x.name === "HttpRequestError" && typeof x.status === "number" && FATAL_STATUSES.includes(x.status)) {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll for an op's receipt until `timeoutMs`.
 * - A receipt with success: returns its transaction hash. With success false:
 *   UserOperationRevertedError at once.
 * - A failed poll (HTTP 429/5xx, network error, request timeout, JSON-RPC error) is
 *   transient: polling goes on, so one blip does not end the wait for an op that is likely to
 *   land. HTTP 401 and 403 (auth, scope) cannot be fixed by retrying and end the wait.
 * - UserOperationPendingError when the deadline passes or on a 401/403, with the last
 *   poll error as its cause.
 */
export async function confirmUserOperation(
  request: ReceiptRequest,
  hash: Hex,
  provider: string,
  timeoutMs: number
): Promise<{ transactionHash: Hex }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    let found: unknown;
    try {
      found = await request(hash);
    } catch (e) {
      if (isAuthRefusal(e)) throw new UserOperationPendingError(hash, provider, e);
      lastError = e;
    }
    if (typeof found === "object" && found !== null) {
      const r = found as { success?: unknown; reason?: unknown; receipt?: { transactionHash?: unknown } };
      if (r.success === false) {
        throw new UserOperationRevertedError(hash, provider, typeof r.reason === "string" ? r.reason : undefined);
      }
      const tx = r.receipt?.transactionHash;
      if (r.success === true && typeof tx === "string" && isHex(tx)) return { transactionHash: tx };
      lastError = "eth_getUserOperationReceipt returned an unreadable receipt";
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new UserOperationPendingError(hash, provider, lastError ?? `no receipt within ${timeoutMs} ms`);
    }
    await sleep(Math.min(POLLING_INTERVAL_MS, remaining));
  }
}

export interface WaitForUserOperationReceiptOptions {
  session: Session;
  chainId: number;
  /** The provider that accepted the op: sendUserOperation's `provider`. */
  provider: "alchemy" | "gelato" | "pimlico";
  userOpHash: Hex;
  /** Defaults to 120 000 ms. */
  timeoutMs?: number;
}

/**
 * Poll `eth_getUserOperationReceipt` through the accounts gas proxy
 * (`/api/v2/bundler/<chain>/<provider>`) until the op is included. Needs scope `write`:
 * the proxy asks for it on every method, receipt reads included.
 * A reverted op throws UserOperationRevertedError; no receipt within `timeoutMs` throws
 * UserOperationPendingError (the op may still land). Transient poll failures are retried
 * until then; a 401 or 403 ends the wait at once as Pending. `timeoutMs` must be > 0
 * (UsageError `timeout_invalid`).
 */
export async function waitForUserOperationReceipt(
  cfg: SdkConfig,
  opts: WaitForUserOperationReceiptOptions
): Promise<{ transactionHash: Hex }> {
  requireScopes(opts.session, ["write"], "waiting for a UserOperation receipt");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Checked before any request: 0 or less would mean no deadline.
  if (!(timeoutMs > 0)) throw new UsageError("timeout_invalid", `timeoutMs must be greater than 0, got ${timeoutMs}`);
  const authed = authedFetch(cfg, opts.session);
  const url = `${normalizeUrl(cfg.accountsUrl)}/api/v2/bundler/${opts.chainId}/${opts.provider}`;
  const client = createBundlerClient({
    transport: http(url, {
      fetchFn: (input: string | URL | Request, init?: RequestInit) =>
        authed(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init),
      retryCount: 0,
      timeout: RECEIPT_REQUEST_TIMEOUT_MS,
    }),
  });
  return confirmUserOperation(
    (hash) => client.request({ method: "eth_getUserOperationReceipt", params: [hash] }, { retryCount: 0 }),
    opts.userOpHash,
    opts.provider,
    timeoutMs
  );
}
