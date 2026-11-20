import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";

import { toChecksumAddress } from "./address.js";
import { EncodingError } from "./errors.js";
import type { KeyCurve } from "./types.js";

const PREFIX = "did:key:z";
// multicodec varints: p256-pub 0x1200 -> 80 24, secp256k1-pub 0xe7 -> e7 01
const CODEC: Record<KeyCurve, readonly [number, number]> = {
  p256: [0x80, 0x24],
  secp256k1: [0xe7, 0x01],
};

export type DecodedDidKey = { curve: KeyCurve; compressed: Uint8Array };

const invalid = (message: string, cause?: unknown): EncodingError =>
  new EncodingError("did_key_invalid", message, { cause });

function assertValidPoint(curve: KeyCurve, compressed: Uint8Array): void {
  if (compressed.length !== 33) throw invalid("compressed public key must be 33 bytes");
  if (compressed[0] !== 0x02 && compressed[0] !== 0x03) throw invalid("invalid compressed point prefix");
  try {
    // Throws if the point is not on the curve.
    (curve === "p256" ? p256 : secp256k1).Point.fromBytes(compressed);
  } catch (cause) {
    throw invalid(`not a point on ${curve}`, cause);
  }
}

export function didKeyFromCompressed(curve: KeyCurve, compressed: Uint8Array): string {
  assertValidPoint(curve, compressed);
  const prefix = CODEC[curve];
  const buf = new Uint8Array(2 + 33);
  buf.set(prefix, 0);
  buf.set(compressed, 2);
  return PREFIX + base58.encode(buf);
}

export function decodeDidKey(didKey: string): DecodedDidKey {
  if (!didKey.startsWith(PREFIX)) throw invalid("not a did:key with base58btc multibase");
  let raw: Uint8Array;
  try {
    raw = base58.decode(didKey.slice(PREFIX.length));
  } catch (cause) {
    throw invalid("did:key is not valid base58btc", cause);
  }
  if (raw.length !== 35) throw invalid("unexpected did:key length");
  for (const curve of ["p256", "secp256k1"] as const) {
    const [a, b] = CODEC[curve];
    if (raw[0] === a && raw[1] === b) {
      const compressed = raw.slice(2);
      assertValidPoint(curve, compressed);
      return { curve, compressed };
    }
  }
  throw invalid("unsupported did:key multicodec");
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** EIP-55 Ethereum address of a secp256k1 did:key. */
export function ethAddressFromDidKey(didKey: string): `0x${string}` {
  const { curve, compressed } = decodeDidKey(didKey);
  if (curve !== "secp256k1") throw invalid("Ethereum address requires a secp256k1 did:key");
  const uncompressed = secp256k1.Point.fromBytes(compressed).toBytes(false);
  return toChecksumAddress("0x" + toHex(keccak_256(uncompressed.slice(1)).slice(12)));
}
