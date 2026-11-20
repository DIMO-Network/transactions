import { describe, expect, it, vi } from "vitest";
import {
  buildSetAliases,
  computeCid,
  encodeSigningPayload,
  toChecksumAddress,
  verifyOpSignature,
  type Operation,
} from "../../../src/accounts/core/index.js";
import { WebCryptoP256Signer } from "../../../src/accounts/signers/webcrypto.js";
import {
  DirectoryIntegrityError,
  DirectoryRejectedError,
  DirectoryUnavailableError,
  HeadMovedError,
  NetworkError,
  PolicyError,
} from "../../../src/accounts/errors.js";
import {
  addDeviceKey,
  removeDeviceKey,
  setAliases,
} from "../../../src/accounts/account/keys.js";
import { DirectoryClient } from "../../../src/accounts/directory/client.js";
import {
  FakeDirectory,
  VECTOR_CHAIN_DID,
  cfgFor,
  json,
  k1Signer,
  router,
  vectorChain,
} from "../helpers.js";

const alias = (hex: string) =>
  "did:ethr:137:" + toChecksumAddress("0x" + hex.repeat(20));

/** A fake directory with a wallet-only genesis for a fresh k1 wallet, wired into cfg. */
async function setup() {
  const dir = new FakeDirectory();
  const wallet = k1Signer();
  const did = await dir.seedGenesis(k1Signer());
  const fetchImpl = router({ [dir.base]: dir.fetch });
  const cfg = cfgFor({ fetchImpl: fetchImpl as unknown as typeof fetch });
  const posts = () => dir.submitted.length;
  return { dir, wallet, did, cfg, fetchImpl, posts };
}

/** The vector chain up to update-add-device (VMs: wallet, signing, device-2). */
function vectorSetup() {
  const dir = new FakeDirectory();
  dir.seed(VECTOR_CHAIN_DID, vectorChain().slice(0, 2));
  const cfg = cfgFor({
    fetchImpl: router({ [dir.base]: dir.fetch }) as unknown as typeof fetch,
  });
  return { dir, cfg, did: VECTOR_CHAIN_DID, wallet: k1Signer() };
}

describe("addDeviceKey", () => {
  it("submits a wallet-signed op with prev = head cid that Go's rules accept", async () => {
    const { dir, wallet, did, cfg } = await setup();
    const newKey = await WebCryptoP256Signer.generate();
    const prev = dir.head(did).cid;
    const res = await addDeviceKey(cfg, { did, wallet, newKey });
    expect(res).toEqual({ cid: dir.head(did).cid, fragment: "signing" });
    const op = dir.submitted[0]!;
    expect(op.prev).toBe(prev);
    expect(op.verificationMethods.signing).toBe(newKey.didKey);
    const { sig, ...unsigned } = op;
    expect(
      verifyOpSignature(encodeSigningPayload(unsigned), sig, wallet.didKey),
    ).toBe(true);
    expect(res.cid).toBe(computeCid(op));
  });

  it("uses an explicit directory when given", async () => {
    const { dir, wallet, did } = await setup();
    const directory = new DirectoryClient(
      dir.base,
      router({ [dir.base]: dir.fetch }) as unknown as typeof fetch,
    );
    const cfg = cfgFor({
      fetchImpl: (() => {
        throw new Error("cfg fetch used");
      }) as unknown as typeof fetch,
    });
    const newKey = await WebCryptoP256Signer.generate();
    await addDeviceKey(cfg, { did, wallet, newKey, directory });
    expect(dir.submitted).toHaveLength(1);
  });

  it("refuses when newKey's proof does not verify, before the wallet signs", async () => {
    const { wallet, did, cfg, posts } = await setup();
    const newKey = await WebCryptoP256Signer.generate();
    const other = await WebCryptoP256Signer.generate();
    const liar = {
      didKey: newKey.didKey,
      sign: (p: Uint8Array) => other.sign(p),
    };
    const e = await addDeviceKey(cfg, { did, wallet, newKey: liar }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(PolicyError);
    expect((e as PolicyError).code).toBe("proof_invalid");
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(posts()).toBe(0);
  });

  it("refuses a wallet that is not a rotation key, without signing", async () => {
    const { did, cfg, posts } = await setup();
    const stranger = k1Signer("22".repeat(32));
    const newKey = await WebCryptoP256Signer.generate();
    await expect(
      addDeviceKey(cfg, { did, wallet: stranger, newKey }),
    ).rejects.toMatchObject({ code: "rotation_locked" });
    expect(stranger.sign).not.toHaveBeenCalled();
    expect(posts()).toBe(0);
  });

  it("retries on HeadMovedError, re-reading the head", async () => {
    const { dir, wallet, did, cfg, fetchImpl } = await setup();
    let first = true;
    dir.beforeSubmit = () => {
      if (!first) return undefined;
      first = false;
      return json({ error: "prev CID does not match current head" }, 409);
    };
    const newKey = await WebCryptoP256Signer.generate();
    await addDeviceKey(cfg, { did, wallet, newKey });
    const audits = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).endsWith("/log/audit"),
    );
    expect(audits).toHaveLength(2);
    expect(wallet.sign).toHaveBeenCalledTimes(2);
    expect(dir.head(did).operation.verificationMethods.signing).toBe(
      newKey.didKey,
    );
  });

  it("gives up after 3 attempts", async () => {
    const { dir, wallet, did, cfg } = await setup();
    dir.beforeSubmit = () => json({ error: "moved" }, 409);
    const newKey = await WebCryptoP256Signer.generate();
    await expect(
      addDeviceKey(cfg, { did, wallet, newKey }),
    ).rejects.toBeInstanceOf(HeadMovedError);
    expect(wallet.sign).toHaveBeenCalledTimes(3);
  });

  it("does not retry on DirectoryRejectedError, DirectoryUnavailableError or NetworkError", async () => {
    for (const [respond, type] of [
      [() => json({ error: "no" }, 400), DirectoryRejectedError],
      [() => json({ error: "down" }, 503), DirectoryUnavailableError],
      [
        () => {
          throw new TypeError("fetch failed");
        },
        NetworkError,
      ],
    ] as const) {
      const { dir, wallet, did, cfg } = await setup();
      dir.beforeSubmit = respond;
      const newKey = await WebCryptoP256Signer.generate();
      await expect(
        addDeviceKey(cfg, { did, wallet, newKey }),
      ).rejects.toBeInstanceOf(type);
      expect(wallet.sign).toHaveBeenCalledTimes(1);
    }
  });

  it("is idempotent: a key already on the head returns its fragment and the head cid without signing", async () => {
    const { dir, wallet, did, cfg, fetchImpl } = await setup();
    const newKey = await WebCryptoP256Signer.generate();
    const posts = () =>
      fetchImpl.mock.calls.filter((c) => c[1]?.method === "POST").length;
    // The first call is applied, but its response is lost.
    dir.beforeSubmit = (d, op) => {
      dir.apply(d, op);
      return json({ error: "gateway timeout" }, 504);
    };
    await expect(
      addDeviceKey(cfg, { did, wallet, newKey }),
    ).rejects.toBeInstanceOf(DirectoryUnavailableError);
    dir.beforeSubmit = undefined;
    wallet.sign.mockClear();
    const newKeySign = vi.spyOn(newKey, "sign");
    const res = await addDeviceKey(cfg, { did, wallet, newKey });
    expect(res).toEqual({ cid: dir.head(did).cid, fragment: "signing" });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(newKeySign).not.toHaveBeenCalled();
    expect(posts()).toBe(1);
  });

  describe("verifies the head before signing", () => {
    type Entry = { cid: string; operation: Operation };
    const tampers: [string, (e: Entry[]) => unknown][] = [
      [
        "an op that does not match its cid",
        (e) => {
          e.at(-1)!.cid = e[0]!.cid;
          return e;
        },
      ],
      [
        "a stale op N-1 paired with cid N",
        (e) => {
          e[1]!.operation = e[0]!.operation;
          return e;
        },
      ],
      [
        "an injected extra verification method",
        (e) => {
          e[1]!.operation.verificationMethods.evil =
            e[1]!.operation.verificationMethods.wallet!;
          return e;
        },
      ],
      [
        "an injected verification method with a recomputed cid",
        (e) => {
          e[1]!.operation.verificationMethods.evil =
            e[1]!.operation.verificationMethods.wallet!;
          e[1]!.cid = computeCid(e[1]!.operation);
          return e;
        },
      ],
    ];
    it.each(tampers)(
      "%s: DirectoryIntegrityError, and the wallet never signs",
      async (_n, tamper) => {
        const { dir, cfg, did, wallet } = vectorSetup();
        dir.tamper = tamper as (e: unknown[]) => unknown;
        const newKey = await WebCryptoP256Signer.generate();
        await expect(
          addDeviceKey(cfg, { did, wallet, newKey }),
        ).rejects.toBeInstanceOf(DirectoryIntegrityError);
        await expect(
          removeDeviceKey(cfg, { did, wallet, fragment: "signing" }),
        ).rejects.toBeInstanceOf(DirectoryIntegrityError);
        await expect(
          setAliases(cfg, { did, wallet, aliases: [alias("ab")] }),
        ).rejects.toBeInstanceOf(DirectoryIntegrityError);
        expect(wallet.sign).not.toHaveBeenCalled();
        expect(dir.submitted).toHaveLength(0);
      },
    );
  });
});

describe("removeDeviceKey", () => {
  it("rejects 'wallet' before any network call", async () => {
    const { wallet, did, cfg, fetchImpl } = await setup();
    await expect(
      removeDeviceKey(cfg, { did, wallet, fragment: "wallet" }),
    ).rejects.toMatchObject({ code: "wallet_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("submits a wallet-signed removal on a Go-signed chain", async () => {
    const { dir, cfg, did, wallet } = vectorSetup();
    const prev = dir.head(did).cid;
    const res = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
    });
    expect(res).toEqual({ cid: dir.head(did).cid });
    const op = dir.submitted[0]!;
    expect(op.prev).toBe(prev);
    expect(op.verificationMethods.signing).toBeUndefined();
    expect(op.verificationMethods["device-2"]).toBeDefined();
  });

  it("is idempotent: an absent fragment returns the head cid without signing", async () => {
    const { dir, cfg, did, wallet } = vectorSetup();
    await removeDeviceKey(cfg, { did, wallet, fragment: "signing" });
    wallet.sign.mockClear();
    const res = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
    });
    expect(res).toEqual({ cid: dir.head(did).cid });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(dir.submitted).toHaveLength(1);
  });

  it.each([
    ["a bare #", "#device-2"],
    ["a full VM id", `${VECTOR_CHAIN_DID}#device-2`],
    ["a name that never existed", "device2"],
    ["an inherited name", "toString"],
    ["constructor", "constructor"],
    ["__proto__", "__proto__"],
  ])(
    "%s: fragment_invalid, no signing and no POST (device-2 stays live)",
    async (_n, fragment) => {
      const { dir, cfg, did, wallet } = vectorSetup();
      await expect(
        removeDeviceKey(cfg, { did, wallet, fragment }),
      ).rejects.toMatchObject({ code: "fragment_invalid" });
      expect(wallet.sign).not.toHaveBeenCalled();
      expect(dir.submitted).toHaveLength(0);
      expect(
        dir.head(did).operation.verificationMethods["device-2"],
      ).toBeDefined();
    },
  );

  it("tells the caller to pass the fragment only when given a VM id", async () => {
    const { cfg, did, wallet } = vectorSetup();
    const e = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: `${did}#device-2`,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PolicyError);
    expect((e as PolicyError).message).toMatch(/fragment only/);
  });

  it("a fragment removed by an earlier op (the retry case) returns the head cid without signing", async () => {
    const { dir, cfg, did, wallet } = vectorSetup();
    // Removed in the previous op, response lost on the way back.
    await removeDeviceKey(cfg, { did, wallet, fragment: "device-2" });
    wallet.sign.mockClear();
    const res = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "device-2",
    });
    expect(res).toEqual({ cid: dir.head(did).cid });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(dir.submitted).toHaveLength(1);
  });
});

describe("removeDeviceKey with a key guard", () => {
  /** wallet-only genesis, then `signing` = keyA added, removed, and re-added as keyB. */
  async function reused() {
    const env = await setup();
    const keyA = await WebCryptoP256Signer.generate();
    const keyB = await WebCryptoP256Signer.generate();
    const { wallet, cfg } = env;
    // setup()'s DID belongs to another wallet: seed one that `wallet` owns.
    const own = await env.dir.seedGenesis(wallet);
    await addDeviceKey(cfg, {
      did: own,
      wallet,
      newKey: keyA,
      fragment: "signing",
    });
    await removeDeviceKey(cfg, {
      did: own,
      wallet,
      fragment: "signing",
      key: keyA.didKey,
    });
    await addDeviceKey(cfg, {
      did: own,
      wallet,
      newKey: keyB,
      fragment: "signing",
    });
    return { ...env, did: own, keyA, keyB };
  }

  it("removes the fragment when it still holds that key", async () => {
    const { dir, cfg, did, wallet, keyB } = await reused();
    const before = dir.submitted.length;
    await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
      key: keyB.didKey,
    });
    expect(dir.submitted).toHaveLength(before + 1);
    expect(dir.head(did).operation.verificationMethods.signing).toBeUndefined();
  });

  it("a stale retry after a re-add is refused: fragment now holds a different key", async () => {
    const { dir, cfg, did, wallet, keyA, keyB } = await reused();
    const before = dir.submitted.length;
    wallet.sign.mockClear();
    const e = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
      key: keyA.didKey,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PolicyError);
    expect(e).toMatchObject({ code: "fragment_invalid" });
    expect((e as PolicyError).message).toContain(
      "fragment now holds a different key",
    );
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(dir.submitted).toHaveLength(before);
    expect(dir.head(did).operation.verificationMethods.signing).toBe(
      keyB.didKey,
    );
  });

  it("without key the behaviour is unchanged: the re-added key is removed", async () => {
    const { dir, cfg, did, wallet } = await reused();
    await removeDeviceKey(cfg, { did, wallet, fragment: "signing" });
    expect(dir.head(did).operation.verificationMethods.signing).toBeUndefined();
  });

  it("an absent fragment is success only when the log had that fragment with that key", async () => {
    const env = await setup();
    const { dir, cfg, wallet } = env;
    const keyA = await WebCryptoP256Signer.generate();
    const other = await WebCryptoP256Signer.generate();
    const did = await dir.seedGenesis(wallet);
    await addDeviceKey(cfg, { did, wallet, newKey: keyA, fragment: "signing" });
    await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
      key: keyA.didKey,
    });
    const posts = dir.submitted.length;
    const again = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
      key: keyA.didKey,
    });
    expect(again).toEqual({ cid: dir.head(did).cid });
    expect(dir.submitted).toHaveLength(posts);
    // Another key never lived on that fragment: not a lost-response retry.
    await expect(
      removeDeviceKey(cfg, {
        did,
        wallet,
        fragment: "signing",
        key: other.didKey,
      }),
    ).rejects.toMatchObject({ code: "fragment_invalid" });
  });
});

describe("addDeviceKey after a removal", () => {
  /** `wallet`'s own DID: keyA added as `signing`, then removed. */
  async function removed() {
    const env = await setup();
    const { dir, cfg, wallet } = env;
    const keyA = await WebCryptoP256Signer.generate();
    const did = await dir.seedGenesis(wallet);
    await addDeviceKey(cfg, { did, wallet, newKey: keyA, fragment: "signing" });
    await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
      key: keyA.didKey,
    });
    wallet.sign.mockClear();
    return { ...env, did, keyA };
  }

  it("a stale retry is refused with key_removed: nothing signed, nothing posted", async () => {
    const { dir, cfg, did, wallet, keyA } = await removed();
    const before = dir.submitted.length;
    const keySign = vi.spyOn(keyA, "sign");
    const e = await addDeviceKey(cfg, { did, wallet, newKey: keyA }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(PolicyError);
    expect(e).toMatchObject({
      code: "key_removed",
      message: "key was removed from this DID; pass allowReAdd to add it again",
    });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(keySign).not.toHaveBeenCalled();
    expect(dir.submitted).toHaveLength(before);
    expect(dir.head(did).operation.verificationMethods.signing).toBeUndefined();
  });

  it("allowReAdd adds it again", async () => {
    const { dir, cfg, did, wallet, keyA } = await removed();
    const before = dir.submitted.length;
    const res = await addDeviceKey(cfg, {
      did,
      wallet,
      newKey: keyA,
      allowReAdd: true,
    });
    expect(dir.submitted).toHaveLength(before + 1);
    expect(dir.head(did).operation.verificationMethods[res.fragment]).toBe(
      keyA.didKey,
    );
    expect(res.cid).toBe(dir.head(did).cid);
  });

  it("a key the log never had is added as before", async () => {
    const { dir, cfg, did, wallet } = await removed();
    const keyB = await WebCryptoP256Signer.generate();
    const res = await addDeviceKey(cfg, { did, wallet, newKey: keyB });
    expect(dir.head(did).operation.verificationMethods[res.fragment]).toBe(
      keyB.didKey,
    );
  });
});

describe("key changes read the audit log once per attempt", () => {
  it("an absent-fragment removal fetches /log/audit exactly once", async () => {
    const { dir, cfg, did, wallet } = vectorSetup();
    await removeDeviceKey(cfg, { did, wallet, fragment: "signing" });
    let audit = 0;
    const base = cfg.fetchImpl!;
    cfg.fetchImpl = (async (u: string | URL | Request, i?: RequestInit) => {
      if (String(u).endsWith("/log/audit")) audit++;
      return base(u, i);
    }) as typeof fetch;
    const res = await removeDeviceKey(cfg, {
      did,
      wallet,
      fragment: "signing",
    });
    expect(res).toEqual({ cid: dir.head(did).cid });
    expect(audit).toBe(1);
  });
});

describe("setAliases", () => {
  it("submits a wallet-signed alias change", async () => {
    const { dir, wallet, did, cfg } = await setup();
    const a = alias("ab");
    const res = await setAliases(cfg, { did, wallet, aliases: [a] });
    expect(res).toEqual({ cid: dir.head(did).cid });
    expect(dir.submitted[0]!.alsoKnownAs).toEqual([a]);
  });

  it("refuses a non-checksummed alias without signing", async () => {
    const { wallet, did, cfg, posts } = await setup();
    await expect(
      setAliases(cfg, {
        did,
        wallet,
        aliases: ["did:ethr:137:0x" + "ab".repeat(20)],
      }),
    ).rejects.toMatchObject({ code: "alias_invalid" });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(posts()).toBe(0);
  });

  it("is idempotent: the same aliases in any order return the head cid without signing", async () => {
    const { dir, wallet, did, cfg, posts } = await setup();
    const [a, b] = [alias("ab"), alias("cd")];
    await dir.append(did, k1Signer(), (head, cid) =>
      buildSetAliases(head, cid, [a, b]),
    );
    const res = await setAliases(cfg, { did, wallet, aliases: [b, a] });
    expect(res).toEqual({ cid: dir.head(did).cid });
    expect(wallet.sign).not.toHaveBeenCalled();
    expect(posts()).toBe(0);
    // A different set still changes.
    await setAliases(cfg, { did, wallet, aliases: [a] });
    expect(posts()).toBe(1);
  });
});
