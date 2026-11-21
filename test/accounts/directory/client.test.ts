import { afterEach, describe, expect, it, vi } from "vitest";

import { PolicyError as CorePolicyError } from "../../../src/accounts/core/errors.js";
import { buildAddKey, computeCid, encodeSigningPayload, type Operation } from "../../../src/accounts/core/index.js";
import { DirectoryClient } from "../../../src/accounts/directory/client.js";
import { verifyAuditLog } from "../../../src/accounts/directory/verify.js";
import {
  AccountSdkError,
  DeactivatedError,
  DidExistsError,
  DidNotFoundError,
  DirectoryIntegrityError,
  DirectoryRejectedError,
  DirectoryUnavailableError,
  HeadMovedError,
  InvalidDidError,
  NetworkError,
  PolicyError,
} from "../../../src/accounts/errors.js";
import {
  FakeDirectory,
  json,
  k1Signer,
  router,
  signedVector,
  strictReceiver,
  vector,
  VECTOR_CHAIN_DID,
  vectorChain,
} from "../helpers.js";

const BASE = "https://dir.test";
const DID = VECTOR_CHAIN_DID;

function client(res: Response | (() => Response)) {
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    typeof res === "function" ? res() : res
  );
  return {
    c: new DirectoryClient(BASE + "/", fetchImpl as unknown as typeof fetch),
    fetchImpl,
  };
}

/** A DirectoryClient over a FakeDirectory seeded with the first `n` vector chain ops. */
function chainClient(n = 3) {
  const dir = new FakeDirectory(BASE);
  dir.seed(DID, vectorChain().slice(0, n));
  const fetchImpl = router({ [BASE]: dir.fetch });
  return {
    dir,
    fetchImpl,
    c: new DirectoryClient(BASE, fetchImpl as unknown as typeof fetch),
  };
}

const integrity = async (p: Promise<unknown>, match?: RegExp) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(DirectoryIntegrityError);
  expect((e as DirectoryIntegrityError).code).toBe("directory_integrity");
  if (match) expect((e as Error).message).toMatch(match);
};

afterEach(() => vi.unstubAllGlobals());

describe("DirectoryClient.resolve", () => {
  it("returns the document on 200", async () => {
    const { c, fetchImpl } = client(json({ id: DID, verificationMethod: [] }));
    expect(await c.resolve(DID)).toEqual({ id: DID, verificationMethod: [] });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/${DID}`);
  });

  it("maps 404 to null and 410 to DeactivatedError", async () => {
    expect(await client(json({ error: "nf" }, 404)).c.resolve(DID)).toBeNull();
    await expect(client(json({ error: "gone" }, 410)).c.resolve(DID)).rejects.toBeInstanceOf(DeactivatedError);
  });

  it("refuses a 200 that is not JSON or names another DID", async () => {
    await integrity(client(() => new Response("<html>")).c.resolve(DID));
    await integrity(client(json({ id: "did:dimo:other" })).c.resolve(DID));
  });
});

describe("DirectoryClient.head (verified audit chain)", () => {
  it("returns the last entry of a valid Go-signed chain", async () => {
    const { c, fetchImpl } = chainClient(3);
    const want = vector("update-remove-device");
    expect(await c.head(DID)).toEqual({
      cid: want.cid,
      op: signedVector("update-remove-device"),
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${BASE}/${DID}/log/audit`);
  });

  it("verifies the genesis alone", async () => {
    const { c } = chainClient(1);
    expect((await c.head(DID)).cid).toBe(vector("genesis-wallet-r1-signing").cid);
  });

  it("throws DeactivatedError when the log ends in a tombstone (did-directory answers 200, not 410)", async () => {
    const { c } = chainClient(4);
    const e = await c.head(DID).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeactivatedError);
    expect((e as DeactivatedError).did).toBe(DID);
    const log = await c.auditLog(DID);
    expect(log.map((x) => x.cid)).toEqual(
      ["genesis-wallet-r1-signing", "update-add-device", "update-remove-device", "tombstone"].map((n) => vector(n).cid)
    );
  });

  it("throws DidNotFoundError on 404 and on an empty log", async () => {
    await expect(client(json({ error: "nf" }, 404)).c.head(DID)).rejects.toBeInstanceOf(DidNotFoundError);
    await expect(client(json([])).c.head(DID)).rejects.toBeInstanceOf(DidNotFoundError);
  });

  it("refuses a log that is not an array or not JSON", async () => {
    await integrity(client(json({ x: 1 })).c.head(DID));
    await integrity(client(() => new Response("nope")).c.head(DID));
  });

  type Entry = {
    did: string;
    cid: string;
    operation: Operation;
    createdAt: string;
  };
  // Each runs against the 3-entry chain (genesis, add, remove) unless it says tombstone.
  const tampers: [string, (e: Entry[]) => unknown, RegExp][] = [
    [
      "an op that does not match its cid",
      (e) => {
        e.at(-1)!.cid = vector("update-set-alias").cid;
        return e;
      },
      /is not the operation's cid/,
    ],
    [
      "a stale op N-1 paired with cid N",
      (e) => {
        e[2]!.operation = e[1]!.operation;
        return e;
      },
      /is not the operation's cid/,
    ],
    [
      "an injected extra verification method",
      (e) => {
        e[2]!.operation.verificationMethods.evil = e[0]!.operation.rotationKeys[0]!;
        return e;
      },
      /is not the operation's cid/,
    ],
    [
      "an injected verification method with a recomputed cid",
      (e) => {
        e[2]!.operation.verificationMethods.evil = e[0]!.operation.rotationKeys[0]!;
        e[2]!.cid = computeCid(e[2]!.operation);
        return e;
      },
      /signature does not verify/,
    ],
    ["a dropped middle entry (broken prev link)", (e) => [e[0], e[2]], /prev .* is not entry 0's cid/],
    ["entries out of order", (e) => [e[1], e[0], e[2]], /genesis must be a plc_operation with prev null/],
    ["an operation after a tombstone", (e) => [...e, e[2]], /after a tombstone/],
    [
      "an entry naming another DID",
      (e) => {
        e[1]!.did = "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa";
        return e;
      },
      /names DID/,
    ],
    [
      "controlled-asset fields",
      (e) => {
        (e[1]!.operation as Record<string, unknown>).controlCommitment = "x";
        return e;
      },
      /unexpected operation field controlCommitment/,
    ],
    [
      "a null alsoKnownAs",
      (e) => {
        (e[1]!.operation as Record<string, unknown>).alsoKnownAs = null;
        return e;
      },
      /alsoKnownAs/,
    ],
    [
      "an unknown operation type",
      (e) => {
        (e[1]!.operation as Record<string, unknown>).type = "dimo_transfer";
        return e;
      },
      /unexpected operation type/,
    ],
  ];

  it.each(tampers)("refuses %s", async (name, tamper, match) => {
    const { c, dir } = chainClient(name.includes("tombstone") ? 4 : 3);
    dir.tamper = tamper;
    await integrity(c.head(DID), match);
  });

  it("refuses a genesis that does not derive the DID", async () => {
    const dir = new FakeDirectory(BASE);
    const other = "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa";
    dir.seed(other, vectorChain().slice(0, 2));
    const c = new DirectoryClient(BASE, router({ [BASE]: dir.fetch }) as unknown as typeof fetch);
    await integrity(c.head(other), /does not derive/);
  });

  it("refuses an update signed by a key that is not a rotation key", async () => {
    const { c, dir } = chainClient(2);
    const stranger = k1Signer("22".repeat(32));
    await dir.append(DID, stranger, (head, cid) => buildAddKey(head, cid, stranger.didKey).op);
    await integrity(c.head(DID), /previous state's rotation keys/);
  });

  it("accepts an update signed by any rotation key of the previous state, as Go does", async () => {
    const wallet = k1Signer();
    const second = k1Signer("33".repeat(32));
    const dir = new FakeDirectory(BASE);
    const did = await dir.seedGenesis(wallet);
    await dir.append(did, wallet, (head, cid) => ({
      ...head,
      rotationKeys: [wallet.didKey, second.didKey],
      prev: cid,
    }));
    await dir.append(did, second, (head, cid) => ({
      ...head,
      rotationKeys: [second.didKey],
      prev: cid,
    }));
    const c = new DirectoryClient(BASE, router({ [BASE]: dir.fetch }) as unknown as typeof fetch);
    expect((await c.head(did)).cid).toBe(dir.head(did).cid);
  });
});

describe("verifyAuditLog", () => {
  it("an empty log is not verified: DirectoryIntegrityError", () => {
    expect(() => verifyAuditLog(VECTOR_CHAIN_DID, [])).toThrow(DirectoryIntegrityError);
  });
});

describe("DirectoryClient.submit", () => {
  it("posts the op and returns did and the verified cid", async () => {
    const op = signedVector("update-add-device");
    const { c, fetchImpl } = client(json({ did: DID, cid: vector("update-add-device").cid }));
    expect(await c.submit(DID, op)).toEqual({
      did: DID,
      cid: vector("update-add-device").cid,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/${DID}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(op);
  });

  it("refuses a 200 whose cid is not the operation's", async () => {
    const op = signedVector("update-add-device");
    await integrity(client(json({ did: DID, cid: vector("tombstone").cid })).c.submit(DID, op));
    await integrity(client(json({ did: DID })).c.submit(DID, op));
    await integrity(client(() => new Response("ok")).c.submit(DID, op));
  });

  it("is accepted by Go's rules end to end", async () => {
    const wallet = k1Signer();
    const dir = new FakeDirectory(BASE);
    const did = await dir.seedGenesis(wallet);
    const c = new DirectoryClient(BASE, router({ [BASE]: dir.fetch }) as unknown as typeof fetch);
    const head = await c.head(did);
    const { op } = buildAddKey(head.op, head.cid, k1Signer("44".repeat(32)).didKey);
    const signed = { ...op, sig: await wallet.sign(encodeSigningPayload(op)) };
    const res = await c.submit(did, signed);
    expect(res.cid).toBe(dir.head(did).cid);
  });

  it("maps 409 to HeadMovedError for updates and DidExistsError for a genesis", async () => {
    const update = signedVector("update-add-device");
    const genesis = signedVector("genesis-wallet-r1-signing");
    await expect(client(json({ error: "prev mismatch" }, 409)).c.submit(DID, update)).rejects.toBeInstanceOf(
      HeadMovedError
    );
    await expect(client(json({ error: "DID already exists" }, 409)).c.submit(DID, genesis)).rejects.toBeInstanceOf(
      DidExistsError
    );
  });

  it("maps 400 to DirectoryRejectedError with status and body", async () => {
    const body = { error: "bad sig", expected: "x" };
    const e = await client(json(body, 400))
      .c.submit(DID, signedVector("update-add-device"))
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DirectoryRejectedError);
    expect((e as DirectoryRejectedError).status).toBe(400);
    expect((e as DirectoryRejectedError).body).toEqual(body);
    expect((e as Error).message).toBe("bad sig");
  });

  it("handles a non-JSON error body", async () => {
    const e = await client(() => new Response("<html>nope</html>", { status: 400 }))
      .c.submit(DID, signedVector("update-add-device"))
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DirectoryRejectedError);
    expect((e as DirectoryRejectedError).body).toBeUndefined();
    expect((e as Error).message).toContain("400");
  });
});

describe("DirectoryClient transport", () => {
  const op = signedVector("update-add-device");

  it.each(["did:dimo:x/../../export", "did:dimo:abc?x=1", "did:dimo:abc#frag", "did:dimo:abcdefghijklmnopqrstuvw"])(
    "rejects bad DID %s with no fetch",
    async (bad) => {
      const { c, fetchImpl } = client(json({}));
      await expect(c.resolve(bad)).rejects.toBeInstanceOf(InvalidDidError);
      await expect(c.head(bad)).rejects.toBeInstanceOf(InvalidDidError);
      await expect(c.submit(bad, op)).rejects.toBeInstanceOf(InvalidDidError);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it("maps 5xx to DirectoryUnavailableError with status", async () => {
    const e = await client(json({ error: "down" }, 503))
      .c.resolve(DID)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DirectoryUnavailableError);
    expect((e as DirectoryUnavailableError).status).toBe(503);
    expect((e as DirectoryUnavailableError).code).toBe("directory_unavailable");
    await expect(client(json({}, 500)).c.head(DID)).rejects.toBeInstanceOf(DirectoryUnavailableError);
    await expect(client(json({}, 502)).c.submit(DID, op)).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });

  describe("429 retry", () => {
    const rl = (retryAfter?: string) =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      });
    const seq = (...rs: Response[]) => {
      const q = [...rs];
      const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => q.shift()!);
      const sleep = vi.fn(async (_ms: number) => {});
      return { fetchImpl, sleep, c: new DirectoryClient(BASE, fetchImpl as unknown as typeof fetch, { sleep }) };
    };

    it("retries 429 then succeeds, honouring Retry-After and clamping it", async () => {
      const { c, sleep, fetchImpl } = seq(rl("2"), rl("60"), rl(), json({ id: DID }));
      await expect(c.resolve(DID)).resolves.toMatchObject({ id: DID });
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map((x) => x[0])).toEqual([2000, 5000, 200 * 4]);
    });

    it("throws DirectoryUnavailableError(429) after 3 retries", async () => {
      const { c, sleep, fetchImpl } = seq(rl(), rl(), rl(), rl());
      const e = await c.resolve(DID).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DirectoryUnavailableError);
      expect((e as DirectoryUnavailableError).status).toBe(429);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map((x) => x[0])).toEqual([200, 400, 800]);
    });

    it("retries a POST submit after 429 with the same body", async () => {
      const genesis = vectorChain()[0]!;
      const { c, fetchImpl } = seq(rl("0"), json({ did: DID, cid: computeCid(genesis) }));
      await expect(c.submit(DID, genesis)).resolves.toEqual({ did: DID, cid: computeCid(genesis) });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1]![1]!.body).toBe(fetchImpl.mock.calls[0]![1]!.body);
      expect(fetchImpl.mock.calls[1]![1]!.method).toBe("POST");
    });
  });

  it("wraps a fetch rejection in NetworkError with cause", async () => {
    const boom = new TypeError("fetch failed");
    const c = new DirectoryClient(BASE, (async () => {
      throw boom;
    }) as unknown as typeof fetch);
    for (const p of [c.resolve(DID), c.head(DID), c.submit(DID, op)]) {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(NetworkError);
      expect(e).toBeInstanceOf(AccountSdkError);
      expect((e as NetworkError).service).toBe("directory");
      expect((e as NetworkError).cause).toBe(boom);
    }
  });

  it("calls an injected fetch unbound (browsers throw Illegal invocation otherwise)", async () => {
    const { dir, fetchImpl } = chainClient(3);
    const c = new DirectoryClient(BASE, strictReceiver(fetchImpl as unknown as typeof fetch));
    expect((await c.head(DID)).cid).toBe(dir.head(DID).cid);
  });

  it("calls the default global fetch unbound", async () => {
    const { dir, fetchImpl } = chainClient(3);
    vi.stubGlobal("fetch", strictReceiver(fetchImpl as unknown as typeof fetch));
    const c = new DirectoryClient(BASE);
    expect((await c.head(DID)).cid).toBe(dir.head(DID).cid);
  });

  it("re-exports the core PolicyError", () => {
    expect(PolicyError).toBe(CorePolicyError);
  });
});
