import { afterEach, describe, expect, it, vi } from "vitest";

import { claimDid } from "../../../src/accounts/account/claim.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import { buildGenesis, deriveDid } from "../../../src/accounts/core/index.js";
import { AccountsError, DeactivatedError, DirectoryRejectedError, PolicyError } from "../../../src/accounts/errors.js";
import { WebCryptoP256Signer } from "../../../src/accounts/signers/webcrypto.js";
import { cfgFor, fakeDauth, FakeDirectory, type Handler, json, router } from "../helpers.js";

const ACCOUNTS = "https://accounts.test";

const viewFor = (did: string, wallet = "0x" + "ab".repeat(20)) => ({
  did,
  email: "a@b.c",
  emailVerified: true,
  subOrganizationId: "so",
  walletAddress: wallet,
  smartAccount: null,
});

/**
 * Directory, dauth and accounts behind one cfg.fetchImpl. The default accounts answers
 * PUT /me/did with the AccountView, and GET /me with 403 unless the signed-in token was
 * granted `read` (as the real server does), so a write-only session shows.
 */
function setup(accounts?: Handler, wrap?: (defaults: Handler) => Handler) {
  const dir = new FakeDirectory();
  const dauth = fakeDauth();
  let scope = "";
  let did = "";
  const dauthSpy: Handler = async (url, init) => {
    if (url.endsWith("/signin/challenge")) {
      const b = JSON.parse(init.body as string);
      scope = b.scope;
      did = b.did;
    }
    return dauth(url, init);
  };
  const defaultAccounts: Handler = async (_url, init) => {
    if (init.method === "PUT") return json(viewFor(did));
    return scope.split(" ").includes("read")
      ? json(viewFor(did))
      : json({ error: { code: "forbidden", message: "scope" } }, 403);
  };
  const fetchImpl = router({
    [dir.base]: dir.fetch,
    "https://dauth.test": dauthSpy,
    [ACCOUNTS]: accounts ?? wrap?.(defaultAccounts) ?? defaultAccounts,
  });
  const cfg = cfgFor({
    accountsUrl: ACCOUNTS + "/",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const calls = () =>
    fetchImpl.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u)}`);
  return { dir, fetchImpl, cfg, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("claimDid", () => {
  it('submits genesis, signs in with key "wallet", then PUT /me/did', async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls, fetchImpl } = setup();
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    const genesis = dir.head(r.did).operation;
    expect(genesis.rotationKeys).toEqual([wallet.didKey]);
    expect(genesis.verificationMethods).toEqual({ wallet: wallet.didKey });
    expect(calls()).toEqual([
      `POST https://dir.test/${r.did}`,
      "POST https://dauth.test/signin/challenge",
      "POST https://dauth.test/signin/token",
      "PUT https://accounts.test/api/v2/me/did",
    ]);
    const body = (i: number) => JSON.parse((fetchImpl.mock.calls[i]![1] as RequestInit).body as string);
    expect(body(1)).toMatchObject({
      did: r.did,
      scope: "read write",
      audience: [ACCOUNTS], // normalized: no trailing slash
    });
    expect(body(2).key).toBe("wallet");
    const put = fetchImpl.mock.calls[3]![1] as RequestInit;
    expect(new Headers(put.headers).get("authorization")).toBe("DPoP jwt");
    expect(r.session.token).toBe("jwt");
    expect(r.session.scopes).toEqual(["read", "write"]);
    expect(r.account).toEqual(viewFor(r.did));
  });

  it("includes signing when signingKey proves possession", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg } = setup();
    const r = await claimDid(cfg, {
      wallet,
      signingKey,
      dpopKey: await generateDpopKey(),
    });
    expect(dir.head(r.did).operation.verificationMethods).toEqual({
      signing: signingKey.didKey,
      wallet: wallet.didKey,
    });
  });

  it("refuses a signingKey that fails proof of possession, before the wallet signs", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const walletSign = vi.spyOn(wallet, "sign");
    const real = await WebCryptoP256Signer.generate();
    const other = await WebCryptoP256Signer.generate();
    const liar = {
      didKey: real.didKey,
      sign: (p: Uint8Array) => other.sign(p),
    };
    const { cfg, fetchImpl } = setup();
    const e = await claimDid(cfg, {
      wallet,
      signingKey: liar,
      dpopKey: await generateDpopKey(),
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PolicyError);
    expect((e as PolicyError).code).toBe("proof_invalid");
    expect(walletSign).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("continues when the genesis already exists and its verified log confirms it", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(r.did).toBe(did);
    expect(calls()).toContain(`GET https://dir.test/${did}/log/audit`);
    expect(calls().at(-1)).toBe("PUT https://accounts.test/api/v2/me/did");
  });

  it("continues on a 409 DidExists as well", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg } = setup();
    const did = await dir.seedGenesis(wallet);
    dir.beforeSubmit = () => json({ error: "DID already exists" }, 409);
    expect((await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).did).toBe(did);
  });

  it("rethrows a 400 when the DID does not exist", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg } = setup();
    dir.beforeSubmit = () => json({ error: "bad genesis" }, 400);
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toBeInstanceOf(
      DirectoryRejectedError
    );
  });

  it("refuses to claim a deactivated DID", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (_h, cid) => ({
      type: "plc_tombstone",
      rotationKeys: [],
      verificationMethods: {},
      alsoKnownAs: [],
      services: {},
      prev: cid,
    }));
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toBeInstanceOf(DeactivatedError);
    expect(calls().some((c) => c.includes("dauth"))).toBe(false);
  });

  it("maps a failed PUT to AccountsError", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg } = setup(async () => json({ error: { code: "forbidden", message: "no" } }, 403));
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toMatchObject({
      name: "AccountsError",
      code: "forbidden",
      status: 403,
    });
  });

  it("a 409 is success when GET /me already shows this DID", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const genesis = buildGenesis({ walletKey: wallet.didKey });
    const did = deriveDid(genesis);
    const { cfg, calls } = setup(async (_url, init) =>
      init.method === "PUT" ? json({ error: { code: "did_already_linked", message: "x" } }, 409) : json(viewFor(did))
    );
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(r.did).toBe(did);
    expect(r.account).toEqual(viewFor(did));
    expect(calls().slice(-2)).toEqual([
      "PUT https://accounts.test/api/v2/me/did",
      "GET https://accounts.test/api/v2/me",
    ]);
  });

  it("a 409 is still an AccountsError when GET /me shows another DID", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg } = setup(async (_url, init) =>
      init.method === "PUT"
        ? json({ error: { code: "did_taken", message: "taken" } }, 409)
        : json(viewFor("did:dimo:someoneelseentirelyxxx"))
    );
    const e = await claimDid(cfg, {
      wallet,
      dpopKey: await generateDpopKey(),
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).toMatchObject({ code: "did_taken", status: 409 });
  });
});

describe("claimDid scope", () => {
  it("a 409 fallback works because the session can read /me (E9 shape)", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
    const { cfg } = setup(
      undefined,
      (def) => async (u, init) =>
        init.method === "PUT" ? json({ error: { code: "conflict", message: "x" } }, 409) : def(u, init)
    );
    const r = await claimDid(cfg, {
      wallet,
      dpopKey: await generateDpopKey(),
    });
    expect(r.did).toBe(did);
    expect(r.account.did).toBe(did);
  });

  it("rejects an opts.scope without read and write before signing", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg, fetchImpl } = setup();
    for (const scope of [["write"], ["read"], ["approve"]] as const) {
      const e = await claimDid(cfg, {
        wallet,
        dpopKey: await generateDpopKey(),
        scope: [...scope],
      }).catch((x: unknown) => x);
      expect(e).toMatchObject({ name: "UsageError", code: "scope_missing" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a wider opts.scope", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg } = setup();
    const r = await claimDid(cfg, {
      wallet,
      dpopKey: await generateDpopKey(),
      scope: ["read", "write", "approve"],
    });
    expect(r.session.scopes).toEqual(["read", "write", "approve"]);
  });
});

describe("claimDid fetch injection", () => {
  it("routes every request through cfg.fetchImpl, never the global", async () => {
    const g = vi.fn(() => {
      throw new Error("global fetch used");
    });
    vi.stubGlobal("fetch", g);
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg, calls } = setup();
    await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(g).not.toHaveBeenCalled();
    expect(calls()).toHaveLength(4);
  });
});

describe("claimDid: the PUT /me/did body", () => {
  it("a 2xx that is not an account is AccountsError invalid_response", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg } = setup(async () => json([viewFor("did:dimo:x")]));
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toMatchObject({
      name: "AccountsError",
      code: "invalid_response",
      status: 200,
    });
  });
});

describe("claimDid: PUT /me/did retries on 503", () => {
  const unavailable = (retryAfter?: string) =>
    new Response(
      JSON.stringify({
        error: { code: "unavailable", message: "DID not visible yet; retry" },
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          ...(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
        },
      }
    );

  /** Records every setTimeout delay and fires immediately. */
  const recordDelays = () => {
    const delays: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return real(fn, 0);
    }) as unknown as typeof setTimeout);
    return delays;
  };

  it("retries, honouring Retry-After, and succeeds", async () => {
    const delays = recordDelays();
    const wallet = await WebCryptoP256Signer.generate();
    let puts = 0;
    const { cfg } = setup(async () => (++puts < 3 ? unavailable("2") : json(viewFor("did:dimo:x"))));
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(r.session.token).toBe("jwt");
    expect(puts).toBe(3);
    expect(delays.filter((d) => d === 2000)).toHaveLength(2);
  });

  it("defaults to 1 s and caps Retry-After at 5 s", async () => {
    const delays = recordDelays();
    const wallet = await WebCryptoP256Signer.generate();
    const headers = [undefined, "999", "abc"];
    let puts = 0;
    const { cfg } = setup(async () => (puts < 3 ? unavailable(headers[puts++]) : json(viewFor("did:dimo:x"))));
    await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(puts).toBe(3);
    expect(delays.filter((d) => d >= 1000)).toEqual([1000, 5000, 1000]);
  });

  it("reads Retry-After the way AccountsError does: integer seconds only, else 1 s", async () => {
    const delays = recordDelays();
    const wallet = await WebCryptoP256Signer.generate();
    const headers = ["1.5", "Wed, 21 Oct 2026 07:28:00 GMT", "-1"];
    let puts = 0;
    const { cfg } = setup(async () => (puts < 3 ? unavailable(headers[puts++]) : json(viewFor("did:dimo:x"))));
    await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(delays.filter((d) => d >= 1000)).toEqual([1000, 1000, 1000]);
  });

  it("gives up after 3 retries (4 attempts) with the AccountsError", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    let puts = 0;
    const { cfg } = setup(async () => {
      puts++;
      return unavailable("0");
    });
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toMatchObject({
      name: "AccountsError",
      code: "unavailable",
      status: 503,
    });
    expect(puts).toBe(4);
  });

  it("does not retry other errors", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    let puts = 0;
    const { cfg } = setup(async () => {
      puts++;
      return json({ error: { code: "bad_gateway", message: "x" } }, 502);
    });
    await expect(claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).rejects.toMatchObject({
      code: "bad_gateway",
    });
    expect(puts).toBe(1);
  });

  it("still treats a 409 whose GET /me shows this DID as success", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
    let puts = 0;
    const { cfg } = setup(async (_u, init) => {
      if (init.method === "PUT") {
        return ++puts === 1 ? unavailable("0") : json({ error: { code: "conflict", message: "x" } }, 409);
      }
      return json(viewFor(did));
    });
    expect((await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() })).did).toBe(did);
  });
});
