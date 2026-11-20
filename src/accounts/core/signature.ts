import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";
import { decodeDidKey } from "./didkey.js";
import { EncodingError } from "./errors.js";

const bad = (message: string): EncodingError =>
  new EncodingError("signature_invalid", message);

const b64u = (b: Uint8Array): string => base64url.encode(b).replace(/=+$/, "");

function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw bad("invalid base64url");
  return base64url.decode(s + "=".repeat((4 - (s.length % 4)) % 4));
}

/**
 * Verify a 64-byte r||s signature (base64url, no padding) over SHA-256(payload).
 * Mirrors did-directory: high-S is accepted (Go crypto/ecdsa and decred do not enforce
 * low-S), and r or s outside [1, n-1] is refused. The message is hashed exactly once, here.
 * Never throws: anything malformed is `false`.
 */
export function verifyOpSignature(
  payload: Uint8Array,
  sig: string,
  didKey: string,
): boolean {
  try {
    const raw = fromB64u(sig);
    if (raw.length !== 64) return false;
    const { curve, compressed } = decodeDidKey(didKey);
    const curveImpl = curve === "p256" ? p256 : secp256k1;
    return curveImpl.verify(raw, sha256(payload), compressed, {
      prehash: false,
      lowS: false,
    });
  } catch {
    return false;
  }
}

/** Left-pad hex r and s to 32 bytes each and encode r||s as base64url without padding. */
export function rsToSig(r: string, s: string): string {
  const pad = (h: string): string => {
    const x = h.replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]*$/.test(x) || x.length > 64) throw bad("invalid r/s");
    return x.padStart(64, "0");
  };
  const hex = pad(r) + pad(s);
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b64u(out);
}

/**
 * Convert an ASN.1 DER ECDSA signature to 64-byte r||s. Curve-agnostic: parses the
 * two INTEGERs directly so no curve order is applied.
 */
export function derToRaw(der: Uint8Array): Uint8Array {
  const readLen = (o: number): [number, number] => {
    const b = der[o];
    if (b === undefined) throw bad("invalid DER");
    if (b < 0x80) return [b, o + 1];
    const n = b & 0x7f;
    if (n < 1 || n > 2) throw bad("invalid DER length");
    let len = 0;
    for (let i = 1; i <= n; i++) {
      const x = der[o + i];
      if (x === undefined) throw bad("invalid DER");
      len = (len << 8) | x;
    }
    return [len, o + 1 + n];
  };
  if (der[0] !== 0x30) throw bad("invalid DER");
  const [seqLen, start] = readLen(1);
  if (start + seqLen !== der.length) throw bad("invalid DER length");
  const out = new Uint8Array(64);
  let o = start;
  for (let k = 0; k < 2; k++) {
    if (der[o] !== 0x02) throw bad("invalid DER integer");
    const [len, vs] = readLen(o + 1);
    if (len === 0 || vs + len > der.length) throw bad("invalid DER integer");
    let v = der.slice(vs, vs + len);
    if ((v[0]! & 0x80) !== 0) throw bad("negative DER integer");
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw bad("DER integer too large");
    out.set(v, k * 32 + 32 - v.length);
    o = vs + len;
  }
  if (o !== der.length) throw bad("trailing DER bytes");
  return out;
}
