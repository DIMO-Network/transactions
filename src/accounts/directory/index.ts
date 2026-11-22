// @dimo-network/transactions/accounts/directory: the verifying did-directory client only. It
// must not load the smart-account, passkey or Turnkey code (and so no viem, @zerodev/* or
// @turnkey/*); test/accounts/entries.test.ts and scripts/check-dist.mjs check that.
export {
  AccountSdkError,
  DeactivatedError,
  DidExistsError,
  DidNotFoundError,
  DirectoryIntegrityError,
  DirectoryRejectedError,
  DirectoryUnavailableError,
  HeadMovedError,
  InvalidDidError,
  NetworkError,
} from "../errors.js";
export { type AuditEntry, type DidDocument, DirectoryClient, type Head } from "./client.js";
export { verifyAuditLog } from "./verify.js";
