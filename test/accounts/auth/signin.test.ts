import { afterEach, describe, expect, it, vi } from "vitest";

import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import { authedFetch } from "../../../src/accounts/auth/fetch.js";
import { signIn } from "../../../src/accounts/auth/signin.js";
import { verifyOpSignature } from "../../../src/accounts/core/index.js";
import { KeyNotAllowedError, NetworkError, SigninError, UsageError } from "../../../src/accounts/errors.js";
import { WebCryptoP256Signer } from "../../../src/accounts/signers/webcrypto.js";
import { cfgFor, fakeDauth, type Handler, json, router } from "../helpers.js";

afterEach(() => vi.unstubAllGlobals());

const claims = (proof: string) => JSON.parse(atob(proof.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));

describe("signIn", () => {
  it("posts challenge with jkt then token with DPoP proof; signs challenge bytes", async () => {
    const signer = await WebCryptoP256Signer.generate();
    const dpopKey = await generateDpopKey();
    const challenge = `dimo.org wants you to sign in as\ndid:dimo:x\n\nFor: dimo.org\nScope: read write\nKey: ${await dpopKey.thumbprint()}\n\nNonce: n1\nIssued At: a\nExpiration Time: b`;
    const calls: { url: string; init: RequestInit }[] = [];
    let verified = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/signin/challenge")) return json({ challenge, nonce: "n1" });
      const body = JSON.parse(init.body as string);
      verified = verifyOpSignature(new TextEncoder().encode(challenge), body.signature, signer.didKey);
      return json({ token: "jwt", expires_in: 600, scope: "read write" });
    });
    const before = Date.now();
    const s = await signIn(cfgFor({ dauthUrl: "https://dauth.test/" }), {
      did: "did:dimo:x",
      signer,
      fragment: "wallet",
      scope: ["read", "write"],
      audience: ["dimo.org"],
      dpopKey,
    });
    expect(calls[0]!.url).toBe("https://dauth.test/signin/challenge");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      did: "did:dimo:x",
      scope: "read write",
      jkt: await dpopKey.thumbprint(),
      audience: ["dimo.org"],
    });
    expect(calls[1]!.url).toBe("https://dauth.test/signin/token");
    const tb = JSON.parse(calls[1]!.init.body as string);
    expect(tb).toMatchObject({ nonce: "n1", key: "wallet" });
    const c = claims(new Headers(calls[1]!.init.headers).get("DPoP")!);
    expect(c.htm).toBe("POST");
    expect(c.htu).toBe("https://dauth.test/signin/token");
    expect(c.ath).toBeUndefined();
    expect(verified).toBe(true);
    expect(s.token).toBe("jwt");
    expect(s.did).toBe("did:dimo:x");
    expect(s.scopes).toEqual(["read", "write"]);
    expect(s.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
  });

  it("defaults the audience to the normalized accountsUrl", async () => {
    const f = router({ "https://dauth.test": fakeDauth() });
    await signIn(
      cfgFor({
        accountsUrl: "https://accounts.test//",
        fetchImpl: f as unknown as typeof fetch,
      }),
      {
        did: "did:dimo:x",
        signer: await WebCryptoP256Signer.generate(),
        fragment: "wallet",
        scope: ["read"],
        dpopKey: await generateDpopKey(),
      }
    );
    const body = JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.audience).toEqual(["https://accounts.test"]);
  });

  it("audience: [] is a UsageError before any network call", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const err = await signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      audience: [],
      dpopKey: await generateDpopKey(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err).toMatchObject({
      code: "audience_empty",
      message: "audience must not be empty; omit it for the default",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("the default audience is checked against the For: line too", async () => {
    const signer = await WebCryptoP256Signer.generate();
    const sign = vi.spyOn(signer, "sign");
    const dauth = fakeDauth();
    const f = router({
      "https://dauth.test": async (url, init) => {
        const res = await dauth(url, init);
        if (!url.endsWith("/signin/challenge")) return res;
        const body = await res.json();
        // dauth names no audience: refused, as for an explicit one.
        body.challenge = body.challenge.replace(/\nFor: [^\n]*/, "");
        return json(body);
      },
    });
    const err = await signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer,
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SigninError);
    expect(err).toMatchObject({ code: "invalid_challenge" });
    expect(sign).not.toHaveBeenCalled();
  });

  it("Session.scopes are the granted scopes, else the requested ones", async () => {
    const run = async (granted: string | null) => {
      const f = router({ "https://dauth.test": fakeDauth({ granted }) });
      return signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
        did: "did:dimo:x",
        signer: await WebCryptoP256Signer.generate(),
        fragment: "wallet",
        scope: ["read", "approve"],
        dpopKey: await generateDpopKey(),
      });
    };
    expect((await run("read")).scopes).toEqual(["read"]);
    expect((await run(null)).scopes).toEqual(["read", "approve"]);
  });

  it("surfaces the dauth error body", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "invalid_grant", error_description: "nope" }, 401));
    const err = await signIn(cfgFor({ dauthUrl: "https://d" }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "signing",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SigninError);
    expect(err.code).toBe("invalid_grant");
    expect(err.status).toBe(401);
  });

  it("a 200 that is not a JSON object is a SigninError server_error", async () => {
    vi.stubGlobal("fetch", async () => new Response("[1]", { status: 200 }));
    const err = await signIn(cfgFor(), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SigninError);
    expect(err.code).toBe("server_error");
  });

  it("wraps a fetch rejection in NetworkError", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const err = await signIn(cfgFor(), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.service).toBe("dauth");
  });

  it("refuses a DpopKey whose thumbprint() disagrees with its jwk()", async () => {
    const key = await generateDpopKey();
    const err = await signIn(cfgFor(), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      dpopKey: { ...key, thumbprint: async () => "other" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect(err.code).toBe("dpop_key_invalid");
  });
});

describe("signIn with an empty scope", () => {
  it("is a UsageError before any network call", async () => {
    const f = vi.fn();
    const e = await signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: [],
      dpopKey: await generateDpopKey(),
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect(e).toMatchObject({ code: "scope_missing" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("authedFetch", () => {
  it("sets Authorization and a fresh DPoP proof with ath", async () => {
    const dpopKey = await generateDpopKey();
    let seen: Headers | undefined;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return json({});
    });
    const f = authedFetch(cfgFor(), {
      did: "d",
      token: "tkn",
      expiresAt: new Date(Date.now() + 1000),
      scopes: [],
      dpopKey,
    });
    await f("https://x.test/a?b=1", {
      method: "PUT",
      headers: { "x-a": "1" },
    });
    expect(seen!.get("authorization")).toBe("DPoP tkn");
    expect(seen!.get("x-a")).toBe("1");
    const c = claims(seen!.get("dpop")!);
    expect(c.htm).toBe("PUT");
    expect(c.htu).toBe("https://x.test/a");
    expect(c.ath).toBeTruthy();
  });

  it("uses cfg.fetchImpl and never globalThis.fetch", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("global fetch used");
    });
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(url);
      return json({});
    }) as typeof fetch;
    await authedFetch(cfgFor({ fetchImpl: f }), {
      did: "did:dimo:x",
      token: "t",
      expiresAt: new Date(),
      scopes: [],
      dpopKey: await generateDpopKey(),
    })("https://x.test/a", { method: "PUT" });
    expect(seen).toEqual(["https://x.test/a"]);
  });
});

describe("signIn challenge validation", () => {
  const did = "did:dimo:x";
  async function run(
    mk: (jkt: string) => { challenge: string; nonce: string },
    scope: Array<"read" | "write" | "approve"> = ["read"]
  ) {
    const real = await WebCryptoP256Signer.generate();
    let signed = 0;
    const signer = {
      didKey: real.didKey,
      sign: (p: Uint8Array) => {
        signed++;
        return real.sign(p);
      },
    };
    const dpopKey = await generateDpopKey();
    const jkt = await dpopKey.thumbprint();
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/signin/challenge") ? json(mk(jkt)) : json({ token: "t", expires_in: 1 })
    );
    const r = await signIn(cfgFor({ dauthUrl: "https://d" }), {
      did,
      signer,
      fragment: "wallet",
      scope,
      audience: ["dimo.org"],
      dpopKey,
    }).catch((e) => e);
    return { r, signed };
  }
  const text = (d: string, jkt: string, n: string, scope = "read") =>
    `dimo.org wants you to sign in as\n${d}\n\nFor: dimo.org\nScope: ${scope}\nKey: ${jkt}\n\nNonce: ${n}\nIssued At: a\nExpiration Time: b`;

  it("refuses a JSON op payload and never signs", async () => {
    const { r, signed } = await run(() => ({
      challenge: '{"type":"update","prev":"x"}',
      nonce: "n",
    }));
    expect(r).toBeInstanceOf(SigninError);
    expect(r.code).toBe("invalid_challenge");
    expect(signed).toBe(0);
  });
  it("refuses wrong DID, jkt and nonce", async () => {
    for (const mk of [
      (j: string) => ({ challenge: text("did:dimo:evil", j, "n"), nonce: "n" }),
      () => ({
        challenge: text(did, "A".repeat(43), "n"),
        nonce: "n",
      }),
      (j: string) => ({ challenge: text(did, j, "other"), nonce: "n" }),
    ]) {
      const { r, signed } = await run(mk);
      expect(r.code).toBe("invalid_challenge");
      expect(signed).toBe(0);
    }
  });
  it("the For: line must equal the audience exactly, not merely contain it", async () => {
    for (const forLine of ["dimo.org.evil.example", "evil.example, dimo.org", "dimo.org, evil.example", "xdimo.org"]) {
      const { r, signed } = await run((j) => ({
        challenge: text(did, j, "n").replace("For: dimo.org", `For: ${forLine}`),
        nonce: "n",
      }));
      expect(r, forLine).toBeInstanceOf(SigninError);
      expect(r.code).toBe("invalid_challenge");
      expect(r.message).toContain("audience");
      expect(signed).toBe(0);
    }
  });
  it("accepts scopes in any order against dauth's canonical order", async () => {
    const { r, signed } = await run(
      (j) => ({ challenge: text(did, j, "n", "read write"), nonce: "n" }),
      ["write", "read"]
    );
    expect(r.token).toBe("t");
    expect(signed).toBe(1);
  });
});

describe("signIn retry on 503/429", () => {
  afterEach(() => vi.useRealTimers());

  const failing = (fail: { path: string; statuses: number[]; retryAfter?: string }) => {
    const dauth = fakeDauth();
    const proofs: string[] = [];
    let n = 0;
    const handler = async (url: string, init: RequestInit) => {
      if (url.endsWith("/signin/token")) proofs.push(new Headers(init.headers).get("DPoP")!);
      if (url.endsWith(fail.path) && n < fail.statuses.length) {
        const status = fail.statuses[n++]!;
        return new Response(JSON.stringify({ error: status === 429 ? "rate_limited" : "unavailable" }), {
          status,
          headers: fail.retryAfter === undefined ? {} : { "retry-after": fail.retryAfter },
        });
      }
      return dauth(url, init);
    };
    const f = router({ "https://dauth.test": handler });
    return { f, proofs, calls: () => n };
  };

  /** Awaits p while advancing fake timers, so each retry sleep elapses once it is registered. */
  const settle = async <T>(p: Promise<T>): Promise<T> => {
    let done = false;
    void p.then(
      () => (done = true),
      () => (done = true)
    );
    for (let i = 0; i < 200 && !done; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      await new Promise<void>((r) => setImmediate(r));
    }
    return p;
  };

  const run = async (f: unknown, signer: WebCryptoP256Signer) =>
    signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer,
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    });

  it("token 503 then 200: one signature, two distinct DPoP proofs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const signer = await WebCryptoP256Signer.generate();
    const sign = vi.spyOn(signer, "sign");
    const { f, proofs } = failing({ path: "/signin/token", statuses: [503], retryAfter: "1" });
    const p = run(f, signer);
    await expect(settle(p)).resolves.toMatchObject({ token: "jwt" });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(proofs).toHaveLength(2);
    expect(claims(proofs[0]!).jti).not.toBe(claims(proofs[1]!).jti);
  });

  it("challenge 429 then success", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const signer = await WebCryptoP256Signer.generate();
    const sign = vi.spyOn(signer, "sign");
    const { f } = failing({ path: "/signin/challenge", statuses: [429], retryAfter: "1" });
    const p = run(f, signer);
    await expect(settle(p)).resolves.toMatchObject({ token: "jwt" });
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("3x 503 throws SigninError with status and retryAfterSeconds (clamped delay)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const signer = await WebCryptoP256Signer.generate();
    const { f, proofs } = failing({ path: "/signin/token", statuses: [503, 503, 503], retryAfter: "30" });
    const p = run(f, signer).catch((e: unknown) => e);
    const err = await settle(p);
    expect(err).toBeInstanceOf(SigninError);
    expect(err).toMatchObject({ status: 503, retryAfterSeconds: 30 });
    expect(proofs).toHaveLength(3);
  });

  it("does not retry a 401", async () => {
    const signer = await WebCryptoP256Signer.generate();
    const { f, proofs, calls } = failing({ path: "/signin/token", statuses: [401] });
    const err = await run(f, signer).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 401 });
    expect(err).toBeInstanceOf(SigninError);
    expect(proofs).toHaveLength(1);
    expect(calls()).toBe(1);
  });
});

describe("approve needs a rotation key (contract 1)", () => {
  const keyNotAllowed: Handler = async (url, init) => {
    if (url.endsWith("/signin/token")) {
      return json({ error: "key_not_allowed", error_description: "approve needs a rotation key" }, 403);
    }
    return fakeDauth()(url, init);
  };

  it("dauth's 403 key_not_allowed is a KeyNotAllowedError (a SigninError) naming the key that signed", async () => {
    const f = router({ "https://dauth.test": keyNotAllowed });
    const err = await signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "signing",
      scope: ["read", "approve"],
      dpopKey: await generateDpopKey(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyNotAllowedError);
    expect(err).toBeInstanceOf(SigninError);
    expect(err).toMatchObject({
      name: "KeyNotAllowedError",
      code: "key_not_allowed",
      status: 403,
      fragment: "signing",
    });
    expect((err as Error).message).toContain("approve needs a rotation key");
    expect((err as Error).message).toContain("#signing");
    // Not retried: one token request.
    expect(f.mock.calls.filter(([u]) => String(u).endsWith("/signin/token"))).toHaveLength(1);
  });

  it("other token errors stay plain SigninErrors", async () => {
    const f = router({
      "https://dauth.test": async (url, init) =>
        url.endsWith("/signin/token")
          ? json({ error: "invalid_grant", error_description: "nope" }, 401)
          : fakeDauth()(url, init),
    });
    const err = await signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "signing",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SigninError);
    expect(err).not.toBeInstanceOf(KeyNotAllowedError);
  });
});

describe("DPoP iat follows dauth's clock, not the device's (R6-F6)", () => {
  afterEach(() => vi.useRealTimers());

  /** A dauth whose clock is `skewMs` ahead of the device, stated in the challenge's Issued At. */
  const skewedDauth = (skewMs: number) => {
    const proofs: string[] = [];
    const handler: Handler = async (url, init) => {
      if (url.endsWith("/signin/token")) proofs.push(new Headers(init.headers).get("DPoP")!);
      const res = await fakeDauth()(url, init);
      if (!url.endsWith("/signin/challenge")) return res;
      const body = await res.json();
      const issued = new Date(Date.now() + skewMs).toISOString().replace(/\.\d{3}Z$/, "Z");
      body.challenge = body.challenge.replace("Issued At: a", `Issued At: ${issued}`);
      return json(body);
    };
    return { f: router({ "https://dauth.test": handler }), proofs };
  };
  const run = async (f: unknown) =>
    signIn(cfgFor({ fetchImpl: f as unknown as typeof fetch }), {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    });
  const serverSeconds = (skewMs: number) => (Date.now() + skewMs) / 1000;

  it.each([
    ["2 minutes fast", -120_000],
    ["10 minutes slow", 600_000],
  ])("a device clock %s: the token proof and later authed proofs carry dauth's time", async (_n, skewMs) => {
    const { f, proofs } = skewedDauth(skewMs);
    const session = await run(f);
    expect(Math.abs(claims(proofs[0]!).iat - serverSeconds(skewMs))).toBeLessThan(3);
    expect(Math.abs(session.clockOffsetMs! - skewMs)).toBeLessThan(2000);
    let proof = "";
    await authedFetch(
      {
        fetchImpl: (async (_u: string, init: RequestInit) => {
          proof = new Headers(init.headers).get("DPoP")!;
          return json({});
        }) as typeof fetch,
      },
      session
    )("https://accounts.test/api/v2/me");
    expect(Math.abs(claims(proof).iat - serverSeconds(skewMs))).toBeLessThan(3);
  });

  it("a clock within a few seconds of dauth's is left alone (no offset)", async () => {
    const { f, proofs } = skewedDauth(0);
    const session = await run(f);
    expect(session.clockOffsetMs).toBeUndefined();
    expect(Math.abs(claims(proofs[0]!).iat - Date.now() / 1000)).toBeLessThan(2);
  });

  it("an unreadable Issued At leaves the device clock alone", async () => {
    const f = router({ "https://dauth.test": fakeDauth() });
    const session = await run(f);
    expect(session.clockOffsetMs).toBeUndefined();
  });
});
