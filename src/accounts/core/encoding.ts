import { encode as cborEncode } from "@ipld/dag-cbor";
import { sha256 } from "@noble/hashes/sha2.js";
import { base32nopad, base58 } from "@scure/base";

import { EncodingError } from "./errors.js";
import type { Operation, UnsignedOperation } from "./types.js";

const enc = new TextEncoder();

const loneSurrogate = (s: string, i: number): EncodingError =>
  new EncodingError(
    "lone_surrogate",
    `lone UTF-16 surrogate at index ${i} of ${JSON.stringify(s)}: Go would re-marshal it as U+FFFD, so the signature could never verify`
  );

// Go json.Marshal string escaping (HTML escaping on). A JS string can hold a lone
// surrogate, which has no UTF-8 form: JSON.stringify sends it as "\udXXX", Go decodes
// that to U+FFFD and re-marshals the raw U+FFFD bytes, so the signed bytes and the
// bytes the directory verifies would differ. Refuse instead of guessing.
function goString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c < 0x20 || c === 0x3c || c === 0x3e || c === 0x26 || c === 0x2028 || c === 0x2029) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      } else throw loneSurrogate(s, i);
    } else if (c >= 0xdc00 && c <= 0xdfff) throw loneSurrogate(s, i);
    else out += s[i]!;
  }
  return out + '"';
}

function compareBytes(a: string, b: string): number {
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

function sortedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort(compareBytes);
}

function goArray(a: string[]): string {
  return "[" + a.map(goString).join(",") + "]";
}

function goMap(o: Record<string, string>): string {
  return (
    "{" +
    sortedKeys(o)
      .map((k) => goString(k) + ":" + goString(o[k]!))
      .join(",") +
    "}"
  );
}

/** Bytes identical to Go's json.Marshal of the unsigned operation (the signing payload). */
export function encodeSigningPayload(op: UnsignedOperation): Uint8Array {
  const services =
    "{" +
    sortedKeys(op.services)
      .map((k) => {
        const s = op.services[k]!;
        return goString(k) + ':{"type":' + goString(s.type) + ',"endpoint":' + goString(s.endpoint) + "}";
      })
      .join(",") +
    "}";
  const json =
    '{"type":' +
    goString(op.type) +
    ',"rotationKeys":' +
    goArray(op.rotationKeys) +
    ',"verificationMethods":' +
    goMap(op.verificationMethods) +
    ',"alsoKnownAs":' +
    goArray(op.alsoKnownAs) +
    ',"services":' +
    services +
    ',"prev":' +
    (op.prev === null ? "null" : goString(op.prev)) +
    "}";
  return enc.encode(json);
}

/** DAG-CBOR of the six-field operation (matches fxamacker canonical encoding). */
export function encodeOperationCbor(op: UnsignedOperation): Uint8Array {
  return cborEncode({
    type: op.type,
    rotationKeys: op.rotationKeys,
    verificationMethods: op.verificationMethods,
    alsoKnownAs: op.alsoKnownAs,
    services: op.services,
    prev: op.prev,
  });
}

/**
 * The operation's CID, as did-directory's Go ComputeCID makes it: the base58btc multihash
 * (sha2-256, 0x12 0x20) of the DAG-CBOR of the unsigned fields. The signature is not part
 * of the CID. Same string form as the vectors' and the audit log's `cid`.
 */
export function computeCid(op: Operation | UnsignedOperation): string {
  const digest = sha256(encodeOperationCbor(op));
  const multihash = new Uint8Array(2 + digest.length);
  multihash[0] = 0x12;
  multihash[1] = 0x20;
  multihash.set(digest, 2);
  return base58.encode(multihash);
}

/** The form deriveDid returns, unanchored: "did:dimo:" and 24 lowercase base32 characters. */
export const DID_SOURCE = "did:dimo:[a-z2-7]{24}";

/** A string that is exactly a DID of the form deriveDid returns. */
export const DID_RE = new RegExp(`^${DID_SOURCE}$`);

/** did:dimo: + first 24 chars of lowercase base32 of SHA-256(DAG-CBOR(genesis)). */
export function deriveDid(genesis: UnsignedOperation): string {
  return (
    "did:dimo:" +
    base32nopad
      .encode(sha256(encodeOperationCbor(genesis)))
      .toLowerCase()
      .slice(0, 24)
  );
}
