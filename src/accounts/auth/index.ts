// @dimo-network/transactions/accounts/auth: sign-in, DPoP and authenticated fetch only. It
// must not load the smart-account, passkey or Turnkey code (and so no viem, @zerodev/* or
// @turnkey/*); test/accounts/entries.test.ts and scripts/check-dist.mjs check that.
export { normalizeUrl, type SdkConfig } from "../config.js";
export {
  AccountSdkError,
  AccountsError,
  ClockSkewError,
  KeyNotAllowedError,
  NetworkError,
  type SdkService,
  SigninError,
  UsageError,
  type UsageErrorCode,
} from "../errors.js";
export type { Signer } from "../signers/types.js";
export { WebCryptoP256Signer } from "../signers/webcrypto.js";
export {
  createDpopProof,
  type DpopJwk,
  type DpopKey,
  dpopKeyFromKeyPair,
  generateDpopKey,
  jwkThumbprint,
  normalizeHtu,
  type WebCryptoDpopKey,
} from "./dpop.js";
export { authedFetch } from "./fetch.js";
export { type Scope, type Session, signIn, type SignInOptions } from "./signin.js";
