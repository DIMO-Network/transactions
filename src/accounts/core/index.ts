export type { UnsignedOperation, Operation, KeyCurve } from "./types.js";
export {
  decodeDidKey,
  didKeyFromCompressed,
  ethAddressFromDidKey,
  type DecodedDidKey,
} from "./didkey.js";
export {
  encodeSigningPayload,
  encodeOperationCbor,
  deriveDid,
  computeCid,
} from "./encoding.js";
export { toChecksumAddress, isChecksumAddress } from "./address.js";
export { verifyOpSignature, rsToSig, derToRaw } from "./signature.js";
export {
  AccountSdkError,
  PolicyError,
  EncodingError,
  type PolicyErrorCode,
  type EncodingErrorCode,
} from "./errors.js";
export { assertPersonDid, isValidFragment } from "./policy.js";
export {
  buildGenesis,
  buildAddKey,
  buildRemoveKey,
  buildSetAliases,
  buildTombstone,
  SIGNUP_POP_MESSAGE,
} from "./ops.js";
