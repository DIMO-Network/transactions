import { describe, expect, it } from "vitest";
import { decodeDidKey, verifyOpSignature } from "../../../src/accounts/core/index.js";
import { WebCryptoP256Signer } from "../../../src/accounts/signers/webcrypto.js";
import { dpopKeyFromKeyPair } from "../../../src/accounts/auth/dpop.js";

describe("WebCryptoP256Signer", () => {
  it("produces a p256 did:key and signatures that verify", async () => {
    const signer = await WebCryptoP256Signer.generate();
    expect(decodeDidKey(signer.didKey).curve).toBe("p256");
    const payload = new TextEncoder().encode("payload");
    const sig = await signer.sign(payload);
    expect(verifyOpSignature(payload, sig, signer.didKey)).toBe(true);
    expect(
      verifyOpSignature(new TextEncoder().encode("other"), sig, signer.didKey),
    ).toBe(false);
  });
});

describe("WebCryptoP256Signer persistence", () => {
  it("keeps a non-extractable pair and exposes it", async () => {
    const signer = await WebCryptoP256Signer.generate();
    expect(signer.keyPair.privateKey.extractable).toBe(false);
    expect(signer.keyPair.privateKey.type).toBe("private");
  });

  it("round-trips through structuredClone (what IndexedDB stores): same did:key, verifiable signatures", async () => {
    const original = await WebCryptoP256Signer.generate();
    const stored = structuredClone(original.keyPair);
    const restored = await WebCryptoP256Signer.fromKeyPair(stored);
    expect(restored.didKey).toBe(original.didKey);
    const payload = new TextEncoder().encode("after a reload");
    const sig = await restored.sign(payload);
    expect(verifyOpSignature(payload, sig, original.didKey)).toBe(true);
  });

  it("refuses a pair that is not ECDSA P-256 for signing", async () => {
    const ed = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const p384 = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-384" },
      false,
      ["sign", "verify"],
    );
    for (const pair of [ed, p384]) {
      await expect(WebCryptoP256Signer.fromKeyPair(pair)).rejects.toMatchObject(
        {
          name: "UsageError",
          code: "key_pair_invalid",
        },
      );
    }
  });
});

describe("fromKeyPair and dpopKeyFromKeyPair hardening", () => {
  const gen = (
    extractable: boolean,
    namedCurve = "P-256",
    name = "ECDSA",
    usages: KeyUsage[] = ["sign", "verify"],
  ) =>
    crypto.subtle.generateKey(
      { name, namedCurve },
      extractable,
      usages,
    ) as Promise<CryptoKeyPair>;

  const entries: [string, (p: CryptoKeyPair) => Promise<unknown>, string][] = [
    ["signer", (p) => WebCryptoP256Signer.fromKeyPair(p), "key_pair_invalid"],
    ["dpop", (p) => dpopKeyFromKeyPair(p), "dpop_key_invalid"],
  ];

  it.each(entries)(
    "%s: refuses an extractable private key",
    async (_n, f, code) => {
      await expect(f(await gen(true))).rejects.toMatchObject({
        name: "UsageError",
        code,
        message: expect.stringMatching(/extractable/),
      });
    },
  );

  it.each(entries)(
    "%s: refuses a mismatched public/private pair",
    async (_n, f, code) => {
      const a = await gen(false);
      const b = await gen(false);
      await expect(
        f({ publicKey: b.publicKey, privateKey: a.privateKey }),
      ).rejects.toMatchObject({ name: "UsageError", code });
    },
  );

  it.each(entries)("%s: refuses an ECDH P-256 pair", async (_n, f, code) => {
    const ecdh = await gen(false, "P-256", "ECDH", ["deriveBits"]);
    await expect(f(ecdh)).rejects.toMatchObject({ name: "UsageError", code });
  });

  it.each(entries)(
    "%s: null and undefined are a typed error",
    async (_n, f, code) => {
      for (const bad of [null, undefined, {}]) {
        await expect(f(bad as unknown as CryptoKeyPair)).rejects.toMatchObject({
          name: "UsageError",
          code,
        });
      }
    },
  );

  it.each(entries)(
    "%s: still accepts a good non-extractable pair",
    async (_n, f) => {
      await expect(f(await gen(false))).resolves.toBeDefined();
    },
  );
});
