/** A secp256k1 signer for a real key that no account owns (E9's "stranger" wallet). */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base64url } from "@scure/base";

// Not in the public index: the did:key encoder is only needed to name this throwaway key.
import { didKeyFromCompressed } from "../../src/accounts/core/index.js";
import type { Signer } from "../../src/accounts/index.js";

export function strangerWallet(): Signer {
  const priv = secp256k1.utils.randomSecretKey();
  const didKey = didKeyFromCompressed("secp256k1", secp256k1.getPublicKey(priv, true));
  return {
    didKey,
    async sign(payload) {
      // r||s over SHA-256(payload), the op signature scheme.
      const sig = secp256k1.sign(payload, priv, { prehash: true });
      return base64url.encode(sig).replace(/=+$/, "");
    },
  };
}
