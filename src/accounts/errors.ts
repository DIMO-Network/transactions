import { AccountSdkError } from "./core/errors.js";

export {
  AccountSdkError,
  EncodingError,
  type EncodingErrorCode,
  PolicyError,
  type PolicyErrorCode,
} from "./core/errors.js";

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** The service a request went to. */
export type SdkService = "accounts" | "dauth" | "directory";

/**
 * fetch itself rejected (offline, DNS, TLS, CORS, abort) on a call to accounts, dauth
 * or the directory. The request may or may not have reached the server, so the outcome
 * is unknown: re-read state before retrying a write. `cause` is fetch's error.
 */
export class NetworkError extends AccountSdkError {
  readonly service: SdkService;
  constructor(service: SdkService, cause: unknown) {
    super("network_error", `${service} request failed: ${describe(cause)}`, {
      cause,
    });
    this.name = "NetworkError";
    this.service = service;
  }
}

/** The directory's head moved (409): the op's prev no longer matches. Re-read and retry. */
export class HeadMovedError extends AccountSdkError {
  constructor(message = "directory head moved") {
    super("head_moved", message);
    this.name = "HeadMovedError";
  }
}

/** The DID has been deactivated: its last operation is a tombstone (or resolve returned 410). */
export class DeactivatedError extends AccountSdkError {
  readonly did: string;
  constructor(did: string) {
    super("did_deactivated", `DID ${did} is deactivated`);
    this.name = "DeactivatedError";
    this.did = did;
  }
}

/** The directory rejected the operation (4xx other than 409). */
export class DirectoryRejectedError extends AccountSdkError {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status = 400, body?: unknown) {
    super("directory_rejected", message);
    this.name = "DirectoryRejectedError";
    this.status = status;
    this.body = body;
  }
}

/** The DID is not the exact derived form did:dimo:<24 lowercase base32 chars>. */
export class InvalidDidError extends AccountSdkError {
  constructor(did: string) {
    super("did_invalid", `invalid DID: ${JSON.stringify(did)}`);
    this.name = "InvalidDidError";
  }
}

/** A genesis was submitted for a DID that already exists (409 on create). */
export class DidExistsError extends AccountSdkError {
  constructor(message = "DID already exists") {
    super("did_exists", message);
    this.name = "DidExistsError";
  }
}

/** The DID is unknown to the directory. */
export class DidNotFoundError extends AccountSdkError {
  readonly did: string;
  constructor(did: string) {
    super("did_not_found", `DID ${did} not found`);
    this.name = "DidNotFoundError";
    this.did = did;
  }
}

/**
 * The directory answered 5xx. The outcome of a write is unknown: re-read the head before
 * retrying. The key-change helpers are idempotent, so calling them again is safe.
 */
export class DirectoryUnavailableError extends AccountSdkError {
  readonly status: number | undefined;
  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super("directory_unavailable", message, options);
    this.name = "DirectoryUnavailableError";
    this.status = status;
  }
}

/**
 * The directory returned data that does not check out: a malformed body, an audit log
 * whose CIDs, prev links, DID derivation or signatures do not verify, or a submit
 * response whose CID is not the operation's. Never retryable; nothing was signed.
 */
export class DirectoryIntegrityError extends AccountSdkError {
  readonly did: string;
  constructor(did: string, message: string, options?: { cause?: unknown }) {
    super("directory_integrity", `${did}: ${message}`, options);
    this.name = "DirectoryIntegrityError";
    this.did = did;
  }
}

/**
 * dauth rejected a sign-in step. `code` is dauth's OAuth-style error code (e.g. invalid_grant).
 * For 503 and 429 (which signIn retries before giving up), `retryAfterSeconds` is dauth's
 * Retry-After when it was an integer number of seconds.
 */
export class SigninError extends AccountSdkError {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(code: string, description: string, status: number, retryAfterSeconds?: number) {
    super(code, `${code}: ${description}`);
    this.name = "SigninError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Retry-After as whole seconds. An HTTP-date, a negative or any other value is ignored (undefined). */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  const h = header?.trim();
  return h !== undefined && /^\d+$/.test(h) ? Number(h) : undefined;
}

/**
 * The accounts service returned an error, built from its `{error:{code,message}}` body.
 * `code` is the server's own code and stays a plain string: the server's envelope is open,
 * so new codes can appear without an SDK release (the SDK adds `invalid_response` for a
 * 2xx body that was not the expected JSON, and `unknown_error` for a body without a code).
 * `retryAfterSeconds` is the response's Retry-After when it was an integer number of seconds.
 */
export class AccountsError extends AccountSdkError {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(code: string, status: number, message: string, retryAfterSeconds?: number) {
    super(code, `${code}: ${message}`);
    this.name = "AccountsError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Read a non-ok accounts response into an AccountsError (tolerates non-JSON bodies). */
  static async fromResponse(res: Response): Promise<AccountsError> {
    let code = "unknown_error";
    let message = `accounts returned HTTP ${res.status}`;
    try {
      const e = (
        JSON.parse(await res.text()) as {
          error?: { code?: unknown; message?: unknown };
        } | null
      )?.error;
      if (typeof e?.code === "string") code = e.code;
      if (typeof e?.message === "string") message = e.message;
    } catch {
      /* non-JSON body */
    }
    return new AccountsError(code, res.status, message, parseRetryAfter(res.headers.get("retry-after")));
  }
}

export type UsageErrorCode =
  | "scope_missing"
  | "audience_empty"
  | "session_required"
  | "rpc_url_missing"
  | "chain_mismatch"
  | "dpop_key_invalid"
  | "key_pair_invalid"
  | "last_passkey"
  | "address_invalid";

/** The SDK was called in a way it refuses: a missing scope or config, a misbehaving DpopKey, or a guarded action. */
export class UsageError extends AccountSdkError {
  declare readonly code: UsageErrorCode;
  constructor(code: UsageErrorCode, message: string) {
    super(code, message);
    this.name = "UsageError";
  }
}

export type TurnkeyErrorCode =
  | "no_signature"
  | "signature_invalid"
  | "public_key_missing"
  | "public_key_mismatch"
  | "wallet_missing"
  | "wallet_ambiguous"
  | "no_authenticator_id";

/** Turnkey answered, but not with what the SDK needs (no signature, a key that does not match, an ambiguous wallet). */
export class TurnkeyError extends AccountSdkError {
  declare readonly code: TurnkeyErrorCode;
  constructor(code: TurnkeyErrorCode, message: string) {
    super(code, message);
    this.name = "TurnkeyError";
  }
}

/** The wallet signer failed or was cancelled while signing a UserOp. Never retried on another provider. */
export class SignerError extends AccountSdkError {
  constructor(cause: unknown) {
    super("signer_failed", `wallet signer failed: ${describe(cause)}`, {
      cause,
    });
    this.name = "SignerError";
  }
}

/** The UserOp was submitted (the bundler returned a hash) but did not confirm. Never resubmitted. */
export class UserOperationPendingError extends AccountSdkError {
  readonly userOpHash: `0x${string}`;
  readonly provider: string;
  constructor(userOpHash: `0x${string}`, provider: string, cause: unknown) {
    super(
      "user_operation_pending",
      `UserOp ${userOpHash} submitted via ${provider} but not confirmed: ${describe(cause)}`,
      { cause }
    );
    this.name = "UserOperationPendingError";
    this.userOpHash = userOpHash;
    this.provider = provider;
  }
}

/**
 * The signed UserOp's send got no definite answer (anything but a JSON-RPC refusal or an
 * HTTP 4xx: a timeout, a network error, an unreadable body, HTTP 5xx, JSON-RPC -32603),
 * and one eth_getUserOperationByHash on the same provider did not return it. That lookup
 * can come back empty even when the provider accepted the op: it may still be in flight,
 * or the bundler may only index included ops. So the op may still land. Before sending
 * again, poll for `userOpHash` (eth_getUserOperationReceipt) or watch the account's
 * EntryPoint nonce: once `EntryPoint.getNonce(sender, nonce >> 64n)` is past `nonce`, an
 * op with this nonce was included. The SDK never tries the next provider after this.
 */
export class UserOperationUnknownError extends AccountSdkError {
  readonly userOpHash: `0x${string}`;
  readonly provider: string;
  /** The op's full EntryPoint nonce (key in the high 192 bits, sequence in the low 64). */
  readonly nonce: bigint;
  constructor(userOpHash: `0x${string}`, provider: string, nonce: bigint, cause: unknown) {
    super(
      "user_operation_unknown",
      `UserOp ${userOpHash} (nonce ${nonce}) sent via ${provider} with an unknown outcome: ${brief(cause)}`,
      { cause }
    );
    this.name = "UserOperationUnknownError";
    this.userOpHash = userOpHash;
    this.provider = provider;
    this.nonce = nonce;
  }
}

/** The UserOp was included on chain and reverted. Final: never resubmitted. */
export class UserOperationRevertedError extends AccountSdkError {
  readonly userOpHash: `0x${string}`;
  readonly provider: string;
  readonly reason: string | undefined;
  constructor(userOpHash: `0x${string}`, provider: string, reason: string | undefined) {
    super("user_operation_reverted", `UserOp ${userOpHash} via ${provider} reverted: ${reason ?? "unknown reason"}`);
    this.name = "UserOperationRevertedError";
    this.userOpHash = userOpHash;
    this.provider = provider;
    this.reason = reason;
  }
}

/**
 * The gas proxy's sponsorship was unusable: no non-zero paymaster (the UserOp would be
 * unsponsored and pay its own gas) or a paymaster outside cfg.allowedPaymasters. Nothing
 * was signed; the SDK moves on to the next provider.
 */
export class SponsorshipError extends AccountSdkError {
  readonly provider: string;
  constructor(code: "not_sponsored" | "paymaster_not_allowed", provider: string, message: string) {
    super(code, `${provider}: ${message}`);
    this.name = "SponsorshipError";
    this.provider = provider;
  }
}

export type GasProxyErrorCode = "proxy_unauthorized" | "proxy_forbidden" | "proxy_rate_limited";

/**
 * The gas proxy refused the request for this session or DID (HTTP 401, 403 or 429), which
 * every other provider would do too, so the SDK does not try the next one. Nothing was
 * signed. For 429, `retryAfterSeconds` is the proxy's Retry-After when it was an integer.
 */
export class GasProxyError extends AccountSdkError {
  declare readonly code: GasProxyErrorCode;
  readonly status: 401 | 403 | 429;
  readonly provider: string;
  readonly retryAfterSeconds?: number;
  constructor(status: 401 | 403 | 429, provider: string, retryAfterSeconds?: number, options?: { cause?: unknown }) {
    super(
      status === 401 ? "proxy_unauthorized" : status === 403 ? "proxy_forbidden" : "proxy_rate_limited",
      `gas proxy (${provider}) answered HTTP ${status}${
        retryAfterSeconds === undefined ? "" : `; retry after ${retryAfterSeconds}s`
      }`,
      options
    );
    this.name = "GasProxyError";
    this.status = status;
    this.provider = provider;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** One line per failed provider: its error's name and short message, with URLs (RPC keys live there) redacted. */
function brief(cause: unknown): string {
  const e = cause as {
    name?: unknown;
    shortMessage?: unknown;
    status?: unknown;
  } | null;
  const base = typeof e?.shortMessage === "string" ? e.shortMessage : describe(cause).split("\n")[0]!;
  const text = typeof e?.status === "number" ? `${base} (HTTP ${e.status})` : base;
  const name = cause instanceof Error && typeof e?.name === "string" ? `${e.name}: ` : "";
  return `${name}${text}`.replace(/https?:\/\/\S+/g, "<url>").slice(0, 200);
}

/**
 * No gas provider took the UserOp: each attempt failed before its send, or its provider
 * refused the send (a JSON-RPC error other than -32603, or an HTTP 4xx). `errors` holds
 * one error per provider, in order, untouched. The message lists `provider: <error name
 * and short message>` with URLs redacted, so it is safe to log.
 */
export class ProvidersExhaustedError extends AccountSdkError {
  readonly errors: unknown[];
  constructor(errors: unknown[], providers: string[] = []) {
    super(
      "providers_exhausted",
      `all gas providers failed: ${errors
        .map((e, i) => `${providers[i] ?? `provider ${i + 1}`}: ${brief(e)}`)
        .join("; ")}`
    );
    this.name = "ProvidersExhaustedError";
    this.errors = errors;
  }
}
