import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";
import { describe, expect, it } from "vitest";

import {
  createDpopProof,
  dpopKeyFromKeyPair,
  generateDpopKey,
  jwkThumbprint,
} from "../../../src/accounts/auth/dpop.js";
import { authedFetch } from "../../../src/accounts/auth/fetch.js";

const b64u = (b: Uint8Array) => base64url.encode(b).replace(/=+$/, "");
const fromB64u = (s: string) => base64url.decode(s + "=".repeat((4 - (s.length % 4)) % 4));
const dec = (s: string) => JSON.parse(new TextDecoder().decode(fromB64u(s)));

describe("dpop", () => {
  it("thumbprint matches RFC 7638 §3.1 example", async () => {
    // RFC 7638 §3.1 is an RSA example, so this uses the EC example JWK from
    // RFC 9449 §4.1 with its published thumbprint.
    const jwk = {
      kty: "EC" as const,
      crv: "P-256" as const,
      x: "l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs",
      y: "9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA",
    };
    expect(await jwkThumbprint(jwk)).toBe("0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I");
  });

  it("proof has typ, alg, jwk and claims", async () => {
    const key = await generateDpopKey();
    const token = "tok.en.value";
    const proof = await createDpopProof(key, "GET", "HTTPS://Accounts.dimo.org/api/v2/me?x=1#y", token);
    const [h, p] = proof.split(".");
    const header = dec(h!);
    const claims = dec(p!);
    expect(header.typ).toBe("dpop+jwt");
    expect(header.alg).toBe("ES256");
    expect(header.jwk).toEqual(await key.jwk());
    expect(claims.htm).toBe("GET");
    expect(claims.htu).toBe("https://accounts.dimo.org/api/v2/me");
    expect(Math.abs(claims.iat - Date.now() / 1000)).toBeLessThan(2);
    expect(claims.jti).toHaveLength(22);
    expect(claims.ath).toBe(b64u(sha256(new TextEncoder().encode(token))));
  });

  it("omits ath without a token", async () => {
    const key = await generateDpopKey();
    const proof = await createDpopProof(key, "POST", "https://a.b/c");
    expect(dec(proof.split(".")[1]!).ath).toBeUndefined();
  });

  it("verifies the way pkg/dpop does", async () => {
    const key = await generateDpopKey();
    const proof = await createDpopProof(key, "POST", "https://a.b/signin/token");
    const [h, p, s] = proof.split(".");
    const { jwk } = dec(h!);
    const pub = new Uint8Array([4, ...fromB64u(jwk.x), ...fromB64u(jwk.y)]);
    const ok = p256.verify(fromB64u(s!), sha256(new TextEncoder().encode(`${h}.${p}`)), pub, {
      prehash: false,
      lowS: false,
    });
    expect(ok).toBe(true);
    expect(await key.thumbprint()).toBe(await jwkThumbprint(jwk));
  });
});

describe("dpop key hygiene", () => {
  it("strips extra jwk members such as d", async () => {
    const key = await generateDpopKey();
    const jwk = { ...(await key.jwk()), d: "secret" };
    const proof = await createDpopProof({ ...key, jwk: async () => jwk }, "GET", "https://a.b/c");
    const header = dec(proof.split(".")[0]!);
    expect(Object.keys(header.jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });
  it("rejects a non P-256 jwk", async () => {
    const key = await generateDpopKey();
    const bad = { ...(await key.jwk()), crv: "P-384" } as never;
    await expect(createDpopProof({ ...key, jwk: async () => bad }, "GET", "https://a.b/c")).rejects.toThrow(/P-256/);
  });
  it("throws on a DER (non 64-byte) signature", async () => {
    const key = await generateDpopKey();
    await expect(
      createDpopProof({ ...key, sign: async () => new Uint8Array(72) }, "GET", "https://a.b/c")
    ).rejects.toThrow(/64-byte/);
  });
});

describe("dpop key persistence", () => {
  it("generateDpopKey exposes its non-extractable pair", async () => {
    const key = await generateDpopKey();
    expect(key.keyPair.privateKey.extractable).toBe(false);
  });

  it("dpopKeyFromKeyPair restores the same jwk and thumbprint; its proofs verify", async () => {
    const original = await generateDpopKey();
    const restored = await dpopKeyFromKeyPair(structuredClone(original.keyPair));
    expect(await restored.jwk()).toEqual(await original.jwk());
    expect(await restored.thumbprint()).toBe(await original.thumbprint());
    const proof = await createDpopProof(restored, "GET", "https://a.b/c", "tok");
    const [h, p, s] = proof.split(".");
    const { jwk } = dec(h!);
    const pub = new Uint8Array([4, ...fromB64u(jwk.x), ...fromB64u(jwk.y)]);
    expect(
      p256.verify(fromB64u(s!), sha256(new TextEncoder().encode(`${h}.${p}`)), pub, {
        prehash: false,
        lowS: false,
      })
    ).toBe(true);
  });

  it("refuses a pair that is not ECDSA P-256", async () => {
    const p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, ["sign", "verify"]);
    await expect(dpopKeyFromKeyPair(p384)).rejects.toMatchObject({
      name: "UsageError",
      code: "dpop_key_invalid",
    });
  });

  it("a Session restored from stored parts authenticates with the same key binding", async () => {
    const dpopKey = await generateDpopKey();
    const session = {
      did: "did:dimo:x",
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000),
      scopes: ["read"],
      dpopKey,
    };
    // What an app would put in IndexedDB: plain fields plus the CryptoKeyPair.
    const stored = structuredClone({
      did: session.did,
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      scopes: session.scopes,
      dpopKeyPair: dpopKey.keyPair,
    });
    const restored = {
      did: stored.did,
      token: stored.token,
      expiresAt: new Date(stored.expiresAt),
      scopes: stored.scopes,
      dpopKey: await dpopKeyFromKeyPair(stored.dpopKeyPair),
    };
    let header: { jwk: unknown } | undefined;
    await authedFetch(
      {
        fetchImpl: (async (_u: string, init: RequestInit) => {
          header = dec(new Headers(init.headers).get("DPoP")!.split(".")[0]!);
          return new Response(null, { status: 204 });
        }) as typeof fetch,
      },
      restored
    )("https://accounts.test/api/v2/me");
    expect(header!.jwk).toEqual(await dpopKey.jwk());
    expect(await restored.dpopKey.thumbprint()).toBe(await dpopKey.thumbprint());
  });
});
