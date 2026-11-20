export { isChecksumAddress, toChecksumAddress } from "./address.js";
export { type DecodedDidKey, decodeDidKey, didKeyFromCompressed, ethAddressFromDidKey } from "./didkey.js";
export { computeCid, deriveDid, encodeOperationCbor, encodeSigningPayload } from "./encoding.js";
export { AccountSdkError, EncodingError, type EncodingErrorCode, PolicyError, type PolicyErrorCode } from "./errors.js";
export {
  buildAddKey,
  buildGenesis,
  buildRemoveKey,
  buildSetAliases,
  buildTombstone,
  SIGNUP_POP_MESSAGE,
} from "./ops.js";
export { assertPersonDid, isValidFragment } from "./policy.js";
export { derToRaw, rsToSig, verifyOpSignature } from "./signature.js";
export type { KeyCurve, Operation, UnsignedOperation } from "./types.js";
