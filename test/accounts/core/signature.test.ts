import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base64url } from "@scure/base";
import { describe, expect, it } from "vitest";

import { derToRaw, didKeyFromCompressed, rsToSig, verifyOpSignature } from "../../../src/accounts/core/index.js";
import vectors from "../fixtures/did-ops.json";

const cases = vectors.cases as unknown as {
  name: string;
  payloadHex: string;
  signerDidKey: string;
  sig: string;
}[];
const b64 = (b: Uint8Array) => base64url.encode(b).replace(/=+$/, "");

describe("verifyOpSignature", () => {
  it.each(cases)("verifies vector signature: $name", (c) => {
    expect(verifyOpSignature(hexToBytes(c.payloadHex), c.sig, c.signerDidKey)).toBe(true);
  });
  it("rejects a tampered payload", () => {
    const c = cases[0]!;
    const p = hexToBytes(c.payloadHex);
    p[0] = p[0]! ^ 1;
    expect(verifyOpSignature(p, c.sig, c.signerDidKey)).toBe(false);
  });
  it("returns false for malformed signatures", () => {
    const c = cases[0]!;
    expect(verifyOpSignature(hexToBytes(c.payloadHex), "AAAA", c.signerDidKey)).toBe(false);
    expect(verifyOpSignature(hexToBytes(c.payloadHex), "!!", c.signerDidKey)).toBe(false);
  });
  it("accepts a high-S signature", () => {
    const priv = secp256k1.utils.randomSecretKey();
    const didKey = didKeyFromCompressed("secp256k1", secp256k1.getPublicKey(priv, true));
    const payload = new TextEncoder().encode("hello");
    const sig = secp256k1.sign(sha256(payload), priv, {
      prehash: false,
      lowS: false,
    });
    const r = BigInt("0x" + Buffer.from(sig.slice(0, 32)).toString("hex"));
    const s = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
    const high = s > secp256k1.Point.Fn.ORDER / 2n ? s : secp256k1.Point.Fn.ORDER - s;
    const raw = hexToBytes(r.toString(16).padStart(64, "0") + high.toString(16).padStart(64, "0"));
    expect(verifyOpSignature(payload, b64(raw), didKey)).toBe(true);
  });
  it("rejects a signature under the wrong key", () => {
    const c = cases[0]!;
    const other = didKeyFromCompressed("secp256k1", secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true));
    expect(verifyOpSignature(hexToBytes(c.payloadHex), c.sig, other)).toBe(false);
  });
  it("accepts a high-S P-256 signature (Go crypto/ecdsa does not enforce low-S)", () => {
    const priv = p256.utils.randomSecretKey();
    const didKey = didKeyFromCompressed("p256", p256.getPublicKey(priv, true));
    const payload = new TextEncoder().encode("hello");
    const sig = p256.sign(sha256(payload), priv, {
      prehash: false,
      lowS: false,
    });
    const r = BigInt("0x" + Buffer.from(sig.slice(0, 32)).toString("hex"));
    const s = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
    const n = p256.Point.Fn.ORDER;
    const high = s > n / 2n ? s : n - s;
    expect(high > n / 2n).toBe(true);
    const raw = hexToBytes(r.toString(16).padStart(64, "0") + high.toString(16).padStart(64, "0"));
    expect(verifyOpSignature(payload, b64(raw), didKey)).toBe(true);
  });
  describe.each([
    ["secp256k1", secp256k1],
    ["p256", p256],
  ] as const)("out-of-range components on %s (Go rejects r or s outside [1, n-1])", (curve, impl) => {
    const priv = impl.utils.randomSecretKey();
    const didKey = didKeyFromCompressed(curve, impl.getPublicKey(priv, true));
    const payload = new TextEncoder().encode("range");
    const sig = impl.sign(sha256(payload), priv, { prehash: false });
    const r = BigInt("0x" + Buffer.from(sig.slice(0, 32)).toString("hex"));
    const s = BigInt("0x" + Buffer.from(sig.slice(32)).toString("hex"));
    const n = impl.Point.Fn.ORDER;
    const enc = (a: bigint, b: bigint) =>
      b64(hexToBytes(a.toString(16).padStart(64, "0") + b.toString(16).padStart(64, "0")));
    const max = 2n ** 256n - 1n;
    it("the unmodified signature verifies", () => {
      expect(verifyOpSignature(payload, enc(r, s), didKey)).toBe(true);
    });
    it.each([
      ["r = 0", 0n, s],
      ["s = 0", r, 0n],
      ["r = n", n, s],
      ["s = n", r, n],
      ["r = 2^256-1", max, s],
      ["s = 2^256-1", r, max],
    ])("%s is rejected", (_name, a, b) => {
      expect(verifyOpSignature(payload, enc(a, b), didKey)).toBe(false);
    });
  });
  it("verifies a P-256 signature", () => {
    const priv = p256.utils.randomSecretKey();
    const didKey = didKeyFromCompressed("p256", p256.getPublicKey(priv, true));
    const payload = new TextEncoder().encode("hello");
    const sig = p256.sign(sha256(payload), priv, { prehash: false });
    expect(verifyOpSignature(payload, b64(sig), didKey)).toBe(true);
    expect(verifyOpSignature(new TextEncoder().encode("hellp"), b64(sig), didKey)).toBe(false);
  });
});

describe("rsToSig", () => {
  it("pads short r and s", () => {
    const raw = base64url.decode(rsToSig("01", "02").padEnd(88, "="));
    expect(raw.length).toBe(64);
    expect(raw[31]).toBe(1);
    expect(raw[63]).toBe(2);
    expect(raw.slice(0, 31).every((x) => x === 0)).toBe(true);
  });
  it("has no padding", () => expect(rsToSig("01", "02")).not.toContain("="));
});

describe("derToRaw", () => {
  it("converts a DER P-256 signature", () => {
    const priv = p256.utils.randomSecretKey();
    const sig = p256.sign(sha256(new Uint8Array([1])), priv, {
      prehash: false,
    });
    const der = p256.Signature.fromBytes(sig, "compact").toBytes("der");
    expect(derToRaw(der)).toEqual(sig);
  });
  it("handles short integers and rejects garbage", () => {
    const raw = derToRaw(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]));
    expect(raw[31]).toBe(1);
    expect(raw[63]).toBe(2);
    expect(() => derToRaw(new Uint8Array([0x31, 0x00]))).toThrow();
  });
});
