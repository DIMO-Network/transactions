export {
  DirectoryClient,
  type DidDocument,
  type AuditEntry,
  type Head,
} from "./directory/client.js";
export { verifyAuditLog } from "./directory/verify.js";
export {
  AccountSdkError,
  PolicyError,
  EncodingError,
  NetworkError,
  HeadMovedError,
  DeactivatedError,
  DirectoryRejectedError,
  InvalidDidError,
  DidExistsError,
  DidNotFoundError,
  DirectoryUnavailableError,
  DirectoryIntegrityError,
  SigninError,
  AccountsError,
  UsageError,
  TurnkeyError,
  SignerError,
  UserOperationPendingError,
  UserOperationUnknownError,
  UserOperationRevertedError,
  SponsorshipError,
  ProvidersExhaustedError,
  GasProxyError,
  type PolicyErrorCode,
  type EncodingErrorCode,
  type UsageErrorCode,
  type GasProxyErrorCode,
  type TurnkeyErrorCode,
  type SdkService,
} from "./errors.js";
export type { Signer } from "./signers/types.js";
export {
  TurnkeyWalletSigner,
  turnkeyWalletDidKey,
  type TurnkeySignMode,
  type TurnkeyWalletSignerOptions,
} from "./signers/turnkey.js";
export { WebCryptoP256Signer } from "./signers/webcrypto.js";
export {
  generateDpopKey,
  dpopKeyFromKeyPair,
  createDpopProof,
  jwkThumbprint,
  type DpopKey,
  type DpopJwk,
  type WebCryptoDpopKey,
} from "./auth/dpop.js";
export {
  signIn,
  type Session,
  type SignInOptions,
  type Scope,
} from "./auth/signin.js";
export { authedFetch } from "./auth/fetch.js";
export {
  addDeviceKey,
  removeDeviceKey,
  setAliases,
  type KeyChangeArgs,
} from "./account/keys.js";
export { normalizeUrl, type SdkConfig } from "./config.js";
export {
  requestEmailCode,
  loginWithEmail,
  loginWithPasskey,
  type LoginResult,
} from "./account/login.js";
export { claimDid } from "./account/claim.js";
export {
  createAccount,
  getMe,
  recordSignIn,
  lookupByWallet,
  type AccountView,
  type AccountChain,
  type CreateAccountInput,
  type CreateAccountPasskeyAttestation,
  type CreateAccountResult,
} from "./account/accounts.js";
export {
  addPasskey,
  removePasskey,
  type PasskeyAttestation,
  type PasskeyTransport,
} from "./account/passkeys.js";
export {
  deploySmartAccount,
  sendUserOperation,
  type GasProvider,
  type SmartAccountOptions,
  type SendUserOperationOptions,
} from "./account/smart-account.js";
export {
  deleteAccount,
  resumeDelete,
  DeleteIncompleteError,
  DeleteHeadMovedError,
  type DeleteIncompleteCode,
  type PendingDeletion,
  type DeleteStep,
  type DeleteAccountOptions,
  type ResumeDeleteOptions,
} from "./account/delete.js";
