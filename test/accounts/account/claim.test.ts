import { afterEach, describe, expect, it, vi } from "vitest";

import { claimDid } from "../../../src/accounts/account/claim.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import {
  buildAddKey,
  buildGenesis,
  computeCid,
  deriveDid,
  encodeSigningPayload,
  type Operation,
  toChecksumAddress,
  verifyOpSignature,
} from "../../../src/accounts/core/index.js";
import type { DirectoryClient } from "../../../src/accounts/directory/client.js";
import {
  AccountSdkError,
  AccountsError,
  DeactivatedError,
  DidExistsError,
  DirectoryRejectedError,
  DirectoryUnavailableError,
  PolicyError,
  RemovePhoneFirstError,
  UnexpectedDidStateError,
} from "../../../src/accounts/errors.js";
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
      // Re-read after the link (fix round 2).
      `GET https://dir.test/${r.did}/log/audit`,
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

  it("with a signingKey: wallet-only genesis, PUT /me/did with no body, then #signing by a wallet-signed update", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls, fetchImpl } = setup();
    const r = await claimDid(cfg, {
      wallet,
      signingKey,
      dpopKey: await generateDpopKey(),
    });
    expect(r.did).toBe(deriveDid(buildGenesis({ walletKey: wallet.didKey })));
    const log = dir.logs.get(r.did)!;
    expect(log).toHaveLength(2);
    expect(log[0]!.operation.verificationMethods).toEqual({ wallet: wallet.didKey });
    expect(dir.head(r.did).operation.verificationMethods).toEqual({
      signing: signingKey.didKey,
      wallet: wallet.didKey,
    });
    const { sig, ...unsigned } = dir.head(r.did).operation;
    expect(verifyOpSignature(encodeSigningPayload(unsigned), sig, wallet.didKey)).toBe(true);
    // The key is added only after the link.
    expect(calls()).toEqual([
      `POST https://dir.test/${r.did}`,
      "POST https://dauth.test/signin/challenge",
      "POST https://dauth.test/signin/token",
      "PUT https://accounts.test/api/v2/me/did",
      `GET https://dir.test/${r.did}/log/audit`,
      `POST https://dir.test/${r.did}`,
    ]);
    const put = fetchImpl.mock.calls[3]![1] as RequestInit;
    expect(put.body).toBeUndefined();
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
    expect(calls().slice(-2)).toEqual([
      "PUT https://accounts.test/api/v2/me/did",
      `GET https://dir.test/${did}/log/audit`,
    ]);
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
    expect(calls().slice(-3)).toEqual([
      "PUT https://accounts.test/api/v2/me/did",
      "GET https://accounts.test/api/v2/me",
      `GET https://dir.test/${did}/log/audit`,
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
    expect(calls()).toHaveLength(5);
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

describe("claimDid: an existing DID must be exactly the genesis it builds (R6-F1)", () => {
  const signedIn = (calls: () => string[]) => calls().some((c) => c.includes("dauth") || c.includes("accounts.test"));

  it("refuses a pre-planted verification method before signing in, listing it", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const attacker = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    // Someone who could sign with the wallet before the claim added a key.
    await dir.append(did, wallet, (h, cid) => ({
      ...h,
      verificationMethods: { ...h.verificationMethods, "device-9": attacker.didKey },
      prev: cid,
    }));
    const sign = vi.spyOn(wallet, "sign");
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toBeInstanceOf(AccountSdkError);
    expect(e).toMatchObject({
      code: "did_unexpected_state",
      did,
      unexpectedKeys: { "device-9": attacker.didKey },
      rotationKeys: [wallet.didKey],
      operations: 2,
    });
    expect((e as Error).message).toContain(`device-9=${attacker.didKey}`);
    expect(signedIn(calls)).toBe(false);
    // Only the genesis was signed (before the submit); no challenge was.
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("refuses a DID whose rotation keys changed after the genesis", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const attacker = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => ({ ...h, rotationKeys: [attacker.didKey], prev: cid }));
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ unexpectedKeys: {}, rotationKeys: [attacker.didKey], operations: 2 });
    expect(signedIn(calls)).toBe(false);
  });

  it("refuses any later operation, even one that adds no key (the log must be exactly [genesis])", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => ({
      ...h,
      alsoKnownAs: ["did:ethr:137:" + toChecksumAddress("0x" + "ab".repeat(20))],
      prev: cid,
    }));
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ unexpectedKeys: {}, operations: 2 });
    expect(signedIn(calls)).toBe(false);
  });
});

describe("claimDid with a signingKey adds #signing only after the link, and resumes (fix round 1)", () => {
  const signingUpdate = (dir: FakeDirectory, did: string) => (op: Operation) =>
    op.prev !== null && op.prev === dir.logs.get(did)?.[0]?.cid;

  it("a failure adding #signing leaves the DID linked; claimDid again finishes it", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
    dir.beforeSubmit = (d, op) =>
      signingUpdate(dir, d)(op) ? json({ error: "upstream unavailable" }, 503) : undefined;
    await expect(claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() })).rejects.toBeInstanceOf(
      DirectoryUnavailableError
    );
    expect(calls()).toContain("PUT https://accounts.test/api/v2/me/did");
    expect(dir.logs.get(did)).toHaveLength(1);

    dir.beforeSubmit = undefined;
    const r = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() });
    expect(r.did).toBe(did);
    expect(dir.head(did).operation.verificationMethods).toEqual({ signing: signingKey.didKey, wallet: wallet.didKey });
  });

  it("a lost answer to the #signing update: claimDid again confirms the link with GET /me and adds nothing", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
    dir.beforeSubmit = (d, op) => {
      if (!signingUpdate(dir, d)(op)) return undefined;
      dir.apply(d, op);
      return json({ error: "gateway timeout" }, 504);
    };
    await expect(claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() })).rejects.toBeInstanceOf(
      DirectoryUnavailableError
    );
    expect(dir.logs.get(did)).toHaveLength(2);

    dir.beforeSubmit = undefined;
    const before = calls().length;
    const submitted = dir.submitted.length;
    const r = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() });
    expect(r.did).toBe(did);
    expect(r.account.did).toBe(did);
    const second = calls().slice(before);
    expect(second).toContain("GET https://accounts.test/api/v2/me");
    expect(second).not.toContain("PUT https://accounts.test/api/v2/me/did");
    // Only the genesis resubmit (409): no second key update.
    expect(dir.submitted.length - submitted).toBe(1);
    expect(dir.logs.get(did)).toHaveLength(2);
  });

  it("[genesis, #signing = the caller's key] on an account that is not linked to it is refused, with no PUT", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup(async (_u, init) =>
      init.method === "PUT" ? json({}) : json({ error: { code: "not_found", message: "no user" } }, 404)
    );
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => buildAddKey(h, cid, signingKey.didKey, "signing").op);
    const e = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ did, operations: 2 });
    expect(calls()).not.toContain("PUT https://accounts.test/api/v2/me/did");
  });

  it("[genesis, #signing = another key] is refused before signing in", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const other = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => buildAddKey(h, cid, other.didKey, "signing").op);
    const e = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ unexpectedKeys: { signing: other.didKey } });
    expect(calls().some((c) => c.includes("dauth"))).toBe(false);
  });

  it("a DID whose genesis carries #signing is refused with UnexpectedDidStateError, listing it", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { cfg, calls } = setup();
    const planted = buildGenesis({ walletKey: wallet.didKey, signingKey: signingKey.didKey });
    const signed: Operation = { ...planted, sig: await wallet.sign(encodeSigningPayload(planted)) };
    // A directory that answers with such a log for this DID (the real one never would: the DID
    // derives from the genesis), so the SDK's own check is what refuses it.
    const directory = {
      submit: async () => {
        throw new DidExistsError();
      },
      auditLog: async (d: string) => [{ did: d, cid: computeCid(signed), operation: signed, createdAt: "t" }],
    } as unknown as DirectoryClient;
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey(), directory }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ unexpectedKeys: { signing: signingKey.didKey }, operations: 1 });
    expect(calls().some((c) => c.includes("dauth"))).toBe(false);
  });
});

describe("claimDid re-checks the log after the link (fix round 2)", () => {
  it.each([true, false])(
    "an op the pre-link signer planted during PUT /me/did is refused after the link (signingKey=%s)",
    async (withSigning) => {
      const wallet = await WebCryptoP256Signer.generate();
      const signingKey = await WebCryptoP256Signer.generate();
      const planted = await WebCryptoP256Signer.generate();
      const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
      const ref: { dir?: FakeDirectory } = {};
      const s = setup(async (_u, init) => {
        // The pre-link signer appends while accounts' link check reads a stale log.
        if (init.method === "PUT")
          await ref.dir!.append(did, wallet, (h, cid) => buildAddKey(h, cid, planted.didKey, "device-2").op);
        return json(viewFor(did));
      });
      ref.dir = s.dir;
      const dir = s.dir;
      const e = await claimDid(s.cfg, {
        wallet,
        ...(withSigning ? { signingKey } : {}),
        dpopKey: await generateDpopKey(),
      }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(UnexpectedDidStateError);
      expect(e).toMatchObject({
        code: "did_unexpected_state",
        linked: true,
        unexpectedKeys: { "device-2": planted.didKey },
        operations: 2,
      });
      expect((e as Error).message).toContain("removeDeviceKey");
      // #signing was never built on the planted head.
      expect(dir.head(did).operation.verificationMethods.signing).toBeUndefined();
      expect(dir.submitted).toHaveLength(1);
    }
  );

  it("a clean link with no signingKey still reads the log once more and succeeds", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const { cfg, calls } = setup();
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(calls().at(-1)).toBe(`GET https://dir.test/${r.did}/log/audit`);
  });

  it("the stuck case (the caller's own #signing on a DID this account isn't linked to) has its own code", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg } = setup(async (_u, init) =>
      init.method === "PUT" ? json({}) : json({ error: { code: "not_found", message: "no user" } }, 404)
    );
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => buildAddKey(h, cid, signingKey.didKey, "signing").op);
    const e = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ code: "did_unlinkable", linked: false, did });
    expect((e as Error).message).toContain("not linked");
    expect((e as Error).message).not.toContain("unexpected keys: none");
  });

  it("genesis plus a #signing update, with no signingKey passed: refused before signing in", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const key = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => buildAddKey(h, cid, key.didKey, "signing").op);
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ code: "did_unexpected_state", linked: false, unexpectedKeys: { signing: key.didKey } });
    expect(calls().some((c) => c.includes("dauth"))).toBe(false);
  });

  it("a three-op log with a signingKey (its own #signing update, then more): refused before signing in", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const signingKey = await WebCryptoP256Signer.generate();
    const { dir, cfg, calls } = setup();
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (h, cid) => buildAddKey(h, cid, signingKey.didKey, "signing").op);
    await dir.append(did, wallet, (h, cid) => ({
      ...h,
      alsoKnownAs: ["did:ethr:137:" + toChecksumAddress("0x" + "ab".repeat(20))],
      prev: cid,
    }));
    const e = await claimDid(cfg, { wallet, signingKey, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UnexpectedDidStateError);
    expect(e).toMatchObject({ code: "did_unexpected_state", unexpectedKeys: {}, operations: 3 });
    expect(calls().some((c) => c.includes("dauth"))).toBe(false);
  });
});

describe("PUT /me/did 409 remove_phone_first (fix round 2)", () => {
  it("is RemovePhoneFirstError (an AccountsError); after removePhone, claimDid again links", async () => {
    const wallet = await WebCryptoP256Signer.generate();
    const did = deriveDid(buildGenesis({ walletKey: wallet.didKey }));
    let phone = true;
    const { cfg, calls } = setup(async (_u, init) => {
      if (init.method === "PUT" && phone) {
        return json(
          { error: { code: "remove_phone_first", message: "remove the phone number from Turnkey first" } },
          409
        );
      }
      return json(viewFor(did));
    });
    const e = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RemovePhoneFirstError);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).toMatchObject({ name: "RemovePhoneFirstError", code: "remove_phone_first", status: 409 });
    // No "409 means already linked" fallback for this code.
    expect(calls()).not.toContain("GET https://accounts.test/api/v2/me");

    phone = false; // the app called removePhone
    const r = await claimDid(cfg, { wallet, dpopKey: await generateDpopKey() });
    expect(r.did).toBe(did);
  });
});
