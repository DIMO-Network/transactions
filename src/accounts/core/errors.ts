/**
 * Base class of every error the SDK throws. `code` is a stable, machine-readable string;
 * branch on it (or on the subclass), never on `message`.
 */
export class AccountSdkError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccountSdkError";
    this.code = code;
  }
}

export type PolicyErrorCode =
  | "wallet_required"
  | "rotation_locked"
  | "fragment_reserved"
  | "fragment_invalid"
  | "key_invalid"
  | "key_removed"
  | "proof_invalid"
  | "alias_invalid"
  | "services_not_allowed"
  | "rotation_keys"
  | "fragment_not_allowed"
  | "root_key_type";

/** An operation would break the person- or org-DID policy (spec §5), or a key failed proof of possession. */
export class PolicyError extends AccountSdkError {
  declare readonly code: PolicyErrorCode;
  constructor(code: PolicyErrorCode, message: string) {
    super(code, message);
    this.name = "PolicyError";
  }
}

export type EncodingErrorCode =
  | "lone_surrogate"
  | "did_key_invalid"
  | "signature_invalid"
  | "address_invalid"
  | "utf8_invalid";

/** Input that cannot be encoded the way did-directory's Go code encodes it. */
export class EncodingError extends AccountSdkError {
  declare readonly code: EncodingErrorCode;
  constructor(code: EncodingErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = "EncodingError";
  }
}
