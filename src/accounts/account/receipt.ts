import { type Hex, http } from "viem";
import { createBundlerClient } from "viem/account-abstraction";

import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import { UserOperationPendingError, UserOperationRevertedError } from "../errors.js";

/** One receipt request waits this long, like every proxy request but the send. */
const RECEIPT_REQUEST_TIMEOUT_MS = 10_000;
const POLLING_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 120_000;

/** The slice of a bundler client that waiting for a receipt uses. */
interface ReceiptWaiter {
  waitForUserOperationReceipt(args: { hash: Hex; timeout: number; pollingInterval: number }): Promise<{
    success: boolean;
    reason?: string | undefined;
    receipt: { transactionHash: Hex };
  }>;
}

/**
 * Wait for an op's receipt: UserOperationPendingError when none arrives within
 * `timeoutMs` (or the wait fails), UserOperationRevertedError when the op ran and failed.
 */
export async function confirmUserOperation(
  client: ReceiptWaiter,
  hash: Hex,
  provider: string,
  timeoutMs: number
): Promise<{ transactionHash: Hex }> {
  let receipt: Awaited<ReturnType<ReceiptWaiter["waitForUserOperationReceipt"]>>;
  try {
    receipt = await client.waitForUserOperationReceipt({
      hash,
      timeout: timeoutMs,
      pollingInterval: POLLING_INTERVAL_MS,
    });
  } catch (e) {
    throw new UserOperationPendingError(hash, provider, e);
  }
  if (!receipt.success) throw new UserOperationRevertedError(hash, provider, receipt.reason);
  return { transactionHash: receipt.receipt.transactionHash };
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
 * UserOperationPendingError (the op may still land).
 */
export async function waitForUserOperationReceipt(
  cfg: SdkConfig,
  opts: WaitForUserOperationReceiptOptions
): Promise<{ transactionHash: Hex }> {
  requireScopes(opts.session, ["write"], "waiting for a UserOperation receipt");
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
  return confirmUserOperation(client, opts.userOpHash, opts.provider, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}
