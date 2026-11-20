import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import vectors from "../fixtures/did-ops.json";
import {
  EncodingError,
  decodeDidKey,
  didKeyFromCompressed,
  ethAddressFromDidKey,
} from "../../src/core/index.js";

const WALLET = vectors.cases[0]!.signerDidKey;
const PHONE = "did:key:zDnaex62me84JZnkEzmeYRa8FCLNe7y1asoSwBMK26GBYpL7c";

describe("didkey", () => {
  it("round-trips both curves", () => {
    for (const [k, curve] of [
      [WALLET, "secp256k1"],
      [PHONE, "p256"],
    ] as const) {
      const d = decodeDidKey(k);
      expect(d.curve).toBe(curve);
      expect(d.compressed.length).toBe(33);
      expect(didKeyFromCompressed(d.curve, d.compressed)).toBe(k);
    }
  });
  it("rejects other multicodecs and malformed input", () => {
    expect(() =>
      decodeDidKey("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"),
    ).toThrow();
    expect(() => decodeDidKey("zQ3s")).toThrow();
    expect(() => decodeDidKey("did:key:abc")).toThrow();
  });
  describe("rejects invalid keys", () => {
    const enc = (head: number[], x: number, prefix = 2, len = 33) => {
      const raw = new Uint8Array(2 + len);
      raw.set(head, 0);
      raw[2] = prefix;
      raw[raw.length - 1] = x;
      return "did:key:z" + base58.encode(raw);
    };
    it("off-curve P-256 point", () =>
      expect(() => decodeDidKey(enc([0x80, 0x24], 1))).toThrow());
    it("off-curve secp256k1 point", () =>
      expect(() => decodeDidKey(enc([0xe7, 0x01], 5))).toThrow());
    it("bad prefix byte", () => {
      const d = decodeDidKey(WALLET);
      const raw = new Uint8Array([0xe7, 0x01, 0x04, ...d.compressed.slice(1)]);
      expect(() => decodeDidKey("did:key:z" + base58.encode(raw))).toThrow();
    });
    it("wrong length", () => {
      expect(() => decodeDidKey(enc([0xe7, 0x01], 5, 2, 32))).toThrow();
      expect(() => decodeDidKey(enc([0xe7, 0x01], 5, 2, 34))).toThrow();
    });
    it("didKeyFromCompressed validates too", () => {
      const bad = new Uint8Array(33);
      bad[0] = 2;
      bad[32] = 1;
      expect(() => didKeyFromCompressed("p256", bad)).toThrow();
      bad[32] = 5;
      expect(() => didKeyFromCompressed("secp256k1", bad)).toThrow();
      bad[0] = 5;
      expect(() => didKeyFromCompressed("secp256k1", bad)).toThrow();
    });
  });
  it("derives the wallet address", () => {
    const c = vectors.cases[0]!;
    const pub = secp256k1.getPublicKey(
      hexToBytes(c.signerPrivateKeyHex),
      false,
    );
    const hex = Array.from(keccak_256(pub.slice(1)).slice(12), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const addr = ethAddressFromDidKey(WALLET);
    expect(addr.toLowerCase()).toBe("0x" + hex);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(addr).not.toBe(addr.toLowerCase()); // EIP-55 mixed case
  });
  it("matches the EIP-55 reference vector", () => {
    // priv=1 -> 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf
    const pub = secp256k1.getPublicKey(
      hexToBytes("00".repeat(31) + "01"),
      true,
    );
    expect(ethAddressFromDidKey(didKeyFromCompressed("secp256k1", pub))).toBe(
      "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    );
  });
  it("returns a 0x-prefixed template type", () => {
    const addr: `0x${string}` = ethAddressFromDidKey(WALLET);
    expect(addr.startsWith("0x")).toBe(true);
  });
  it("throws EncodingError for malformed did:keys", () => {
    for (const bad of [
      "did:key:abc",
      "zQ3s",
      "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    ]) {
      expect(() => decodeDidKey(bad)).toThrow(EncodingError);
    }
    expect(() => ethAddressFromDidKey(PHONE)).toThrow(EncodingError);
  });
  it("rejects address derivation for p256", () => {
    expect(() => ethAddressFromDidKey(PHONE)).toThrow();
  });
});
