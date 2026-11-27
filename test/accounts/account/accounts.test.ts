import { describe, expect, it, vi } from "vitest";

import {
  type AccountView,
  createAccount,
  type CreateAccountInput,
  getMe,
  lookupByWallet,
  recordSignIn,
} from "../../../src/accounts/account/accounts.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import type { Session } from "../../../src/accounts/auth/signin.js";
import { SIGNUP_POP_MESSAGE, verifyOpSignature } from "../../../src/accounts/core/index.js";
import { AccountsError, LinkRequiredError } from "../../../src/accounts/errors.js";
import { WebCryptoP256Signer } from "../../../src/accounts/signers/webcrypto.js";
import { cfgFor, json, router } from "./../helpers.js";

const ACCOUNTS = "https://accounts.test";
const VIEW: AccountView = {
  did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa",
  email: "a@b.c",
  emailVerified: true,
  subOrganizationId: "so",
  walletAddress: "0x" + "ab".repeat(20),
  smartAccount: null,
};
const errBody = (code: string, message = "m") => ({ error: { code, message } });

function setup(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchImpl = router({ [ACCOUNTS]: handler });
  const cfg = cfgFor({
    accountsUrl: ACCOUNTS + "/",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const sent = () =>
    fetchImpl.mock.calls.map(([u, i]) => ({
      url: String(u),
      method: (i as RequestInit | undefined)?.method ?? "GET",
      headers: new Headers((i as RequestInit | undefined)?.headers),
      body:
        typeof (i as RequestInit | undefined)?.body === "string"
          ? JSON.parse((i as RequestInit).body as string)
          : undefined,
    }));
  return { cfg, fetchImpl, sent };
}

async function session(scopes: string[]): Promise<Session> {
  return {
    did: VIEW.did,
    token: "tok",
    expiresAt: new Date(Date.now() + 60_000),
    dpopKey: await generateDpopKey(),
    scopes,
  };
}

describe("createAccount", () => {
  // accounts src/models/v2/validations.ts:14-48 (CreateAccountSchema) and
  // src/models/v2/accounts.d.ts:3-18 (CreateAccountRequest). Top-level keys:
  const REQUEST_KEYS = ["email", "proof", "sessionPublicKey", "passkey", "signingKey", "smartAccount"];
  // signingKey: validations.ts:34-36 -> { didKey, proof }
  // passkey: validations.ts:23-33 -> { challenge, attestation: { credentialId,
  //   clientDataJson, attestationObject, transports } }
  // smartAccount: validations.ts:37-47 -> { chain, coSigner? }
  // proof: validations.ts:16-21 -> { codeId, code } | { idToken }

  it("POSTs the exact schema shape to /api/v2/accounts without auth", async () => {
    const key = await WebCryptoP256Signer.generate();
    const { cfg, sent } = setup(async () => json({ account: VIEW, credentialBundle: "bundle" }, 201));
    const passkey = {
      challenge: "ch",
      attestation: {
        credentialId: "cid",
        clientDataJson: "cdj",
        attestationObject: "ao",
        transports: ["AUTHENTICATOR_TRANSPORT_INTERNAL" as const],
      },
    };
    const r = await createAccount(cfg, {
      email: "  A@B.C ",
      proof: { codeId: "id", code: "123456" },
      sessionPublicKey: "spk",
      passkey,
      signingKey: key,
      smartAccount: { chain: "POLYGON", coSigner: "0x" + "cd".repeat(20) },
    });
    expect(r).toEqual({ account: VIEW, credentialBundle: "bundle" });
    const [req] = sent();
    expect(req!.url).toBe(`${ACCOUNTS}/api/v2/accounts`);
    expect(req!.method).toBe("POST");
    expect(req!.headers.get("authorization")).toBeNull();
    expect(req!.headers.get("dpop")).toBeNull();
    expect(req!.headers.get("content-type")).toBe("application/json");
    expect(Object.keys(req!.body).sort()).toEqual([...REQUEST_KEYS].sort());
    expect(req!.body.email).toBe("  A@B.C "); // the server normalizes; the proof signs the normalized form
    expect(req!.body.proof).toEqual({ codeId: "id", code: "123456" });
    expect(req!.body.sessionPublicKey).toBe("spk");
    expect(req!.body.passkey).toEqual(passkey);
    expect(Object.keys(req!.body.signingKey).sort()).toEqual(["didKey", "proof"].sort());
    expect(req!.body.signingKey.didKey).toBe(key.didKey);
    expect(req!.body.smartAccount).toEqual({
      chain: "POLYGON",
      coSigner: "0x" + "cd".repeat(20),
    });
  });

  it("builds a proof of possession over SIGNUP_POP_MESSAGE(trim+lowercase email, didKey)", async () => {
    const key = await WebCryptoP256Signer.generate();
    const { cfg, sent } = setup(async () => json({ account: VIEW }, 201));
    await createAccount(cfg, { email: "  Mixed@Case.IO ", signingKey: key });
    const sk = sent()[0]!.body.signingKey;
    const msg = new TextEncoder().encode(SIGNUP_POP_MESSAGE("mixed@case.io", key.didKey));
    expect(sk.proof).toMatch(/^[A-Za-z0-9_-]{86}$/); // 64 bytes, base64url, no padding
    expect(verifyOpSignature(msg, sk.proof, key.didKey)).toBe(true);
  });

  it("sends only what was given (no signingKey, no extras)", async () => {
    const { cfg, sent } = setup(async () => json({ account: VIEW }, 201));
    const r = await createAccount(cfg, {
      email: "a@b.c",
      proof: { idToken: "jwt" },
    });
    expect(r).toEqual({ account: VIEW });
    expect(sent()[0]!.body).toEqual({
      email: "a@b.c",
      proof: { idToken: "jwt" },
    });
  });

  it("refuses a Signer whose proof does not verify, sending nothing", async () => {
    const real = await WebCryptoP256Signer.generate();
    const other = await WebCryptoP256Signer.generate();
    const liar = {
      didKey: real.didKey,
      sign: (p: Uint8Array) => other.sign(p),
    };
    const { cfg, fetchImpl } = setup(async () => json({ account: VIEW }, 201));
    await expect(createAccount(cfg, { email: "a@b.c", signingKey: liar })).rejects.toMatchObject({
      name: "PolicyError",
      code: "proof_invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signs the proof once and sends that signature", async () => {
    const key = await WebCryptoP256Signer.generate();
    const sign = vi.spyOn(key, "sign");
    const { cfg, sent } = setup(async () => json({ account: VIEW }, 201));
    await createAccount(cfg, { email: "a@b.c", signingKey: key });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sent()[0]!.body.signingKey.proof).toBe(await sign.mock.results[0]!.value);
  });

  it("maps 409 to AccountsError conflict, message passed through", async () => {
    const { cfg } = setup(async () => json(errBody("conflict", "signup in progress"), 409));
    const e = await createAccount(cfg, { email: "a@b.c" }).catch((x: unknown) => x);
    expect(e).toMatchObject({
      name: "AccountsError",
      code: "conflict",
      status: 409,
    });
    expect((e as Error).message).toContain("signup in progress");
  });

  it("maps 409 link_required to LinkRequiredError (an AccountsError): claim with the SDK instead", async () => {
    const { cfg } = setup(async () => json(errBody("link_required", "claim with the SDK and PUT /api/v2/me/did"), 409));
    const e = await createAccount(cfg, { email: "a@b.c" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LinkRequiredError);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).toMatchObject({ name: "LinkRequiredError", code: "link_required", status: 409 });
    expect((e as Error).message).toBe("link_required: claim with the SDK and PUT /api/v2/me/did");
  });

  it("a conflict 409 is not LinkRequiredError, and link_required on another status is not either", async () => {
    for (const [code, status] of [
      ["conflict", 409],
      ["link_required", 400],
    ] as const) {
      const { cfg } = setup(async () => json(errBody(code), status));
      const e = await createAccount(cfg, { email: "a@b.c" }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AccountsError);
      expect(e).not.toBeInstanceOf(LinkRequiredError);
    }
  });

  it("maps other failures to AccountsError with the envelope code", async () => {
    const { cfg } = setup(async () => json(errBody("rate_limited"), 429));
    await expect(createAccount(cfg, { email: "a@b.c" })).rejects.toMatchObject({
      name: "AccountsError",
      code: "rate_limited",
      status: 429,
    });
  });

  it("maps a rejected fetch to NetworkError", async () => {
    const cfg = cfgFor({
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
    });
    await expect(createAccount(cfg, { email: "a@b.c" })).rejects.toMatchObject({
      name: "NetworkError",
    });
  });

  it("rejects a 2xx body that is not an account", async () => {
    const { cfg } = setup(async () => json({ nope: 1 }, 201));
    await expect(createAccount(cfg, { email: "a@b.c" })).rejects.toMatchObject({
      name: "AccountsError",
      code: "invalid_response",
    });
  });
});

describe("a 2xx body of the wrong shape is invalid_response, with the status", () => {
  const raw = (body: string, status: number) => async () =>
    new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  const helpers: [
    string,
    number,
    Record<string, unknown>,
    (cfg: ReturnType<typeof setup>["cfg"]) => Promise<unknown>,
  ][] = [
    ["createAccount", 201, { account: VIEW }, (cfg) => createAccount(cfg, { email: "a@b.c" })],
    [
      "getMe",
      200,
      VIEW as unknown as Record<string, unknown>,
      async (cfg) => getMe(cfg, { session: await session(["read"]) }),
    ],
    ["lookupByWallet", 200, { did: VIEW.did }, (cfg) => lookupByWallet(cfg, { address: "0x" + "ab".repeat(20) })],
  ];
  for (const [name, status, good, call] of helpers) {
    it.each([
      ["not JSON", "<html>"],
      ["an array", JSON.stringify([good])],
      ["null", "null"],
      ["an object without the fields", JSON.stringify({ nope: 1 })],
    ])(`${name}: %s`, async (_n, body) => {
      const { cfg } = setup(raw(body, status));
      await expect(call(cfg)).rejects.toMatchObject({
        name: "AccountsError",
        code: "invalid_response",
        status,
      });
    });
    it(`${name}: the expected body still passes`, async () => {
      const { cfg } = setup(raw(JSON.stringify(good), status));
      await expect(call(cfg)).resolves.toBeDefined();
    });
  }
});

describe("createAccount passkey transports", () => {
  it("the server's transport list excludes SMART_CARD, and the types say so", () => {
    const att = {
      credentialId: "c",
      clientDataJson: "d",
      attestationObject: "a",
    };
    const ok: CreateAccountInput["passkey"] = {
      challenge: "x",
      attestation: { ...att, transports: ["AUTHENTICATOR_TRANSPORT_HYBRID"] },
    };
    const bad: CreateAccountInput["passkey"] = {
      challenge: "x",
      attestation: {
        ...att,
        // @ts-expect-error accounts' TRANSPORTS has no AUTHENTICATOR_TRANSPORT_SMART_CARD
        transports: ["AUTHENTICATOR_TRANSPORT_SMART_CARD"],
      },
    };
    expect([ok, bad]).toHaveLength(2);
  });
});

describe("getMe", () => {
  // accounts: GET /api/v2/me (scope read) -> AccountView
  // src/services/v2/signup.service.ts:45-52, did, email, emailVerified,
  // subOrganizationId, walletAddress, smartAccount
  it("GETs /api/v2/me with DPoP auth and returns the view", async () => {
    const { cfg, sent } = setup(async () => json(VIEW));
    expect(await getMe(cfg, { session: await session(["read"]) })).toEqual(VIEW);
    const [req] = sent();
    expect(req!.url).toBe(`${ACCOUNTS}/api/v2/me`);
    expect(req!.method).toBe("GET");
    expect(req!.headers.get("authorization")).toBe("DPoP tok");
    expect(req!.headers.get("dpop")).toBeTruthy();
  });

  it("returns null on 404 not_found", async () => {
    const { cfg } = setup(async () => json(errBody("not_found"), 404));
    expect(await getMe(cfg, { session: await session(["read"]) })).toBeNull();
  });

  it("a 404 without the accounts envelope is an error, not null", async () => {
    const { cfg } = setup(async () => new Response("nope", { status: 404 }));
    await expect(getMe(cfg, { session: await session(["read"]) })).rejects.toMatchObject({
      name: "AccountsError",
      status: 404,
    });
  });

  it("fails fast without the read scope", async () => {
    const { cfg, fetchImpl } = setup(async () => json(VIEW));
    await expect(getMe(cfg, { session: await session(["write"]) })).rejects.toMatchObject({
      name: "UsageError",
      code: "scope_missing",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps other failures to AccountsError", async () => {
    const { cfg } = setup(async () => json(errBody("unauthenticated"), 401));
    await expect(getMe(cfg, { session: await session(["read"]) })).rejects.toMatchObject({
      code: "unauthenticated",
      status: 401,
    });
  });
});

describe("recordSignIn", () => {
  it("POSTs { deviceKey } to /api/v2/me/sign-ins and resolves on 202", async () => {
    const key = await WebCryptoP256Signer.generate();
    const { cfg, sent } = setup(async () => new Response(null, { status: 202 }));
    await expect(
      recordSignIn(cfg, {
        session: await session(["write"]),
        deviceKey: key.didKey,
      })
    ).resolves.toBeUndefined();
    const [req] = sent();
    expect(req!.url).toBe(`${ACCOUNTS}/api/v2/me/sign-ins`);
    expect(req!.method).toBe("POST");
    expect(req!.headers.get("authorization")).toBe("DPoP tok");
    expect(req!.headers.get("content-type")).toBe("application/json");
    // P4 Task 7 contract: body { deviceKey }
    expect(Object.keys(req!.body)).toEqual(["deviceKey"]);
    expect(req!.body.deviceKey).toBe(key.didKey);
  });

  it("fails fast without the write scope", async () => {
    const key = await WebCryptoP256Signer.generate();
    const { cfg, fetchImpl } = setup(async () => new Response(null, { status: 202 }));
    await expect(
      recordSignIn(cfg, {
        session: await session(["read"]),
        deviceKey: key.didKey,
      })
    ).rejects.toMatchObject({ name: "UsageError", code: "scope_missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a deviceKey that is not a did:key before any request", async () => {
    const { cfg, fetchImpl } = setup(async () => new Response(null, { status: 202 }));
    await expect(
      recordSignIn(cfg, {
        session: await session(["write"]),
        deviceKey: "not-a-did-key",
      })
    ).rejects.toBeInstanceOf(Error);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps 404 and other failures to AccountsError", async () => {
    const key = await WebCryptoP256Signer.generate();
    const { cfg } = setup(async () => json(errBody("not_found"), 404));
    await expect(
      recordSignIn(cfg, {
        session: await session(["write"]),
        deviceKey: key.didKey,
      })
    ).rejects.toMatchObject({ name: "AccountsError", code: "not_found" });
  });
});

describe("lookupByWallet", () => {
  // accounts src/app/api/v2/accounts/by-wallet/[address]/route.ts:7 (ADDRESS_RE),
  // :27-33 (404 not_found), :34 (200 body { did })
  const ADDR = "0x" + "aB".repeat(20);

  it("GETs by-wallet/{address} without auth and returns the did", async () => {
    const { cfg, sent } = setup(async () => json({ did: VIEW.did }));
    expect(await lookupByWallet(cfg, { address: ADDR })).toBe(VIEW.did);
    const [req] = sent();
    expect(req!.url).toBe(`${ACCOUNTS}/api/v2/accounts/by-wallet/${ADDR}`);
    expect(req!.method).toBe("GET");
    expect(req!.headers.get("authorization")).toBeNull();
  });

  it("returns null on 404", async () => {
    const { cfg } = setup(async () => json(errBody("not_found"), 404));
    expect(await lookupByWallet(cfg, { address: ADDR })).toBeNull();
  });

  it.each(["0x123", "ab".repeat(20), "0x" + "g".repeat(40), "0x" + "a".repeat(41)])(
    "rejects %s before any request",
    async (bad) => {
      const { cfg, fetchImpl } = setup(async () => json({ did: VIEW.did }));
      await expect(lookupByWallet(cfg, { address: bad })).rejects.toMatchObject({
        name: "UsageError",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("maps other failures to AccountsError", async () => {
    const { cfg } = setup(async () => json(errBody("rate_limited"), 429));
    await expect(lookupByWallet(cfg, { address: ADDR })).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
});
