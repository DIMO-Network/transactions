import { p256 } from "@noble/curves/nist.js";
import { base64url } from "@scure/base";

import { didKeyFromCompressed } from "../core/index.js";
import { UsageError } from "../errors.js";
import type { Signer } from "./types.js";

/**
 * Check that `pair` is a usable device key: ECDSA P-256, a non-extractable private key
 * that can sign, and a public key that matches it (a sign/verify round trip). Throws
 * UsageError `code` otherwise, for null, undefined and malformed input too.
 */
export async function assertP256SigningPair(
  pair: CryptoKeyPair,
  code: "key_pair_invalid" | "dpop_key_invalid",
  what: string
): Promise<void> {
  const refuse = (why: string): never => {
    throw new UsageError(code, `${what}: ${why}`);
  };
  const alg = (k: CryptoKey) => k.algorithm as EcKeyAlgorithm;
  const priv = pair?.privateKey;
  const pub = pair?.publicKey;
  if (!priv || !pub || priv.type !== "private" || pub.type !== "public")
    return refuse("expected a CryptoKeyPair with a private and a public key");
  if (
    alg(priv).name !== "ECDSA" ||
    alg(priv).namedCurve !== "P-256" ||
    alg(pub).name !== "ECDSA" ||
    alg(pub).namedCurve !== "P-256" ||
    !priv.usages.includes("sign")
  )
    return refuse("needs ECDSA P-256 with a private key that can sign");
  if (priv.extractable) return refuse("the private key is extractable; generate it with extractable: false");
  try {
    const probe = crypto.getRandomValues(new Uint8Array(32));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, probe);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, probe);
    if (!ok) return refuse("the public key does not match the private key");
  } catch (cause) {
    if (cause instanceof UsageError) throw cause;
    return refuse("the key pair failed a sign/verify self-check");
  }
}

/**
 * A device key held by WebCrypto: ECDSA P-256, private key non-extractable. Persist
 * `keyPair` as-is (IndexedDB stores CryptoKey objects without exposing the private key)
 * and rebuild with `fromKeyPair` after a reload.
 */
export class WebCryptoP256Signer implements Signer {
  private constructor(
    readonly didKey: string,
    /** The underlying pair, for persistence. The private key stays non-extractable. */
    readonly keyPair: CryptoKeyPair
  ) {}

  /** Generate a non-extractable ECDSA P-256 key pair. */
  static async generate(): Promise<WebCryptoP256Signer> {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    return WebCryptoP256Signer.fromKeyPair(pair);
  }

  /**
   * Rebuild a signer from a stored pair. Throws UsageError `key_pair_invalid` unless the
   * pair is ECDSA P-256 with a non-extractable private key that can sign and a public key
   * that matches it (checked by signing and verifying once). null, undefined and
   * malformed input are refused the same way.
   */
  static async fromKeyPair(pair: CryptoKeyPair): Promise<WebCryptoP256Signer> {
    await assertP256SigningPair(pair, "key_pair_invalid", "WebCryptoP256Signer");
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const compressed = p256.Point.fromBytes(raw).toBytes(true);
    return new WebCryptoP256Signer(didKeyFromCompressed("p256", compressed), pair);
  }

  async sign(payload: Uint8Array): Promise<string> {
    // WebCrypto ECDSA output is already raw r||s (P1363), 64 bytes for P-256.
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keyPair.privateKey, payload as BufferSource)
    );
    return base64url.encode(sig).replace(/=+$/, "");
  }
}
