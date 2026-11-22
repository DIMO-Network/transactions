import { type TurnkeyClient, TurnkeyRequestError } from "@turnkey/http";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  deleteAccount,
  DeleteHeadMovedError,
  DeleteIncompleteError,
  type PendingDeletion,
  resumeDelete,
} from "../../../src/accounts/account/delete.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import type { Session } from "../../../src/accounts/auth/signin.js";
import {
  buildSetAliases,
  computeCid,
  encodeSigningPayload,
  ethAddressFromDidKey,
  toChecksumAddress,
  verifyOpSignature,
} from "../../../src/accounts/core/index.js";
import {
  AccountsError,
  DeactivatedError,
  DirectoryRejectedError,
  HeadMovedError,
  NetworkError,
  SoleOrgAdminError,
  TurnkeyError,
  UsageError,
} from "../../../src/accounts/errors.js";
import { cfgFor, FakeDirectory, type Handler, json, k1Signer, router } from "../helpers.js";

const ACCOUNTS = "https://accounts.test";
const SUB = "sub-org-1";
const OTHER_SUB = "org-root-sub-org";
const OTHER_WALLET = toChecksumAddress("0x" + "cd".repeat(20));
const completed = async () => ({
  activity: { id: "a", status: "ACTIVITY_STATUS_COMPLETED", result: {} },
});

async function setup(
  opts: {
    scopes?: string[];
    tkFails?: boolean;
    accounts?: Handler;
  } = {}
) {
  const order: string[] = [];
  const dir = new FakeDirectory();
  const owner = k1Signer();
  const did = await dir.seedGenesis(owner);
  const wallet = k1Signer();
  const realSign = wallet.sign.getMockImplementation()!;
  wallet.sign.mockImplementation(async (p: Uint8Array) => {
    order.push("sign");
    return realSign(p);
  });
  const accounts = vi.fn<Handler>(opts.accounts ?? (async () => new Response(null, { status: 204 })));
  const fetchImpl = router({
    [dir.base]: async (url, init) => {
      order.push(init.method === "POST" ? "submit" : url.endsWith("/log/audit") ? "audit" : "resolve");
      return dir.fetch(url, init);
    },
    [ACCOUNTS]: async (url, init) => {
      order.push("accounts");
      return accounts(url, init);
    },
  });
  const cfg = cfgFor({
    accountsUrl: ACCOUNTS + "/",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const deleteSubOrganization = vi.fn(async () => {
    order.push("turnkey");
    if (opts.tkFails) throw new Error("turnkey down");
    return completed();
  });
  // SUB holds the wallet; OTHER_SUB (say, an org root the same stamper can reach) does not.
  const walletAccounts: Record<string, { addressFormat: string; address: string; path: string }[]> = {
    [SUB]: [
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        address: ethAddressFromDidKey(wallet.didKey),
        path: "m/44'/60'/0'/0/0",
      },
    ],
    [OTHER_SUB]: [{ addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: OTHER_WALLET, path: "m/44'/60'/0'/0/0" }],
  };
  const getWalletAccounts = vi.fn(async ({ organizationId }: { organizationId: string }) => {
    order.push("wallets");
    return { accounts: walletAccounts[organizationId] ?? [] };
  });
  const turnkey = { deleteSubOrganization, getWalletAccounts } as unknown as TurnkeyClient;
  const session: Session = {
    did,
    token: "tok",
    expiresAt: new Date(Date.now() + 60_000),
    dpopKey: await generateDpopKey(),
    scopes: opts.scopes ?? ["read", "approve"],
  };
  const args = (deleteWithoutExport = false) =>
    [
      cfg,
      {
        session,
        wallet,
        turnkeyWithUserStamper: turnkey,
        subOrganizationId: SUB,
        deleteWithoutExport,
      },
    ] as const;
  const tombstoned = () => dir.head(did).operation.type === "plc_tombstone";
  return {
    order,
    dir,
    did,
    owner,
    wallet,
    accounts,
    fetchImpl,
    cfg,
    turnkey,
    deleteSubOrganization,
    getWalletAccounts,
    session,
    args,
    tombstoned,
  };
}

type S = Awaited<ReturnType<typeof setup>>;

async function pendingAfterTkFailure(s: S): Promise<PendingDeletion> {
  const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DeleteIncompleteError);
  s.deleteSubOrganization.mockImplementation(async () => {
    s.order.push("turnkey");
    return completed();
  });
  return (err as DeleteIncompleteError).pending;
}

/** Another writer moves the head (an alias change signed by the wallet). */
const moveHead = (s: S) =>
  s.dir.append(s.did, s.owner, (head, cid) =>
    buildSetAliases(head, cid, ["did:ethr:137:" + toChecksumAddress("0x" + "ab".repeat(20))])
  );

describe("deleteAccount", () => {
  it("order: head, sub-org holds the wallet, sign tombstone, DELETE /me, re-check head, Turnkey delete, submit tombstone", async () => {
    const s = await setup();
    const prev = s.dir.head(s.did).cid;
    const res = await deleteAccount(...s.args());
    expect(s.order).toEqual(["audit", "wallets", "sign", "accounts", "audit", "turnkey", "submit"]);
    expect(s.getWalletAccounts).toHaveBeenCalledWith({ organizationId: SUB });
    expect(res.walletAddress).toBe(ethAddressFromDidKey(s.wallet.didKey));
    expect(s.wallet.sign).toHaveBeenCalledTimes(1);
    const [url, init] = s.accounts.mock.calls[0]!;
    expect(url).toBe(`${ACCOUNTS}/api/v2/me`);
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("DPoP tok");
    const op = s.dir.submitted[0]!;
    expect(op.prev).toBe(prev);
    const { sig, ...unsigned } = op;
    expect(verifyOpSignature(encodeSigningPayload(unsigned), sig, s.wallet.didKey)).toBe(true);
    expect(res.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(res.signedTombstone).toEqual(op);
    expect(s.tombstoned()).toBe(true);
  });

  it("fails before signing when the session lacks the approve scope", async () => {
    const s = await setup({ scopes: ["read", "write"] });
    const e = await deleteAccount(...s.args()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect((e as UsageError).code).toBe("scope_missing");
    expect(s.wallet.sign).not.toHaveBeenCalled();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a deactivated DID before signing", async () => {
    const s = await setup();
    await deleteAccount(...s.args());
    s.wallet.sign.mockClear();
    await expect(deleteAccount(...s.args())).rejects.toBeInstanceOf(DeactivatedError);
    expect(s.wallet.sign).not.toHaveBeenCalled();
  });

  it("if Turnkey delete fails, the signed tombstone is returned for resumeDelete", async () => {
    const s = await setup({ tkFails: true });
    const prev = s.dir.head(s.did).cid;
    const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    const pending = (err as DeleteIncompleteError).pending;
    expect(pending.stepsDone).toEqual(["accounts"]);
    expect(pending.did).toBe(s.did);
    expect(pending.subOrganizationId).toBe(SUB);
    expect(pending.prevCid).toBe(prev);
    expect(pending.signedTombstone.prev).toBe(prev);
    expect(s.dir.submitted).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
  });

  it("a 4xx from DELETE /me (other than 404) is an AccountsError; Turnkey and the directory are untouched", async () => {
    const s = await setup({
      accounts: async () => json({ error: { code: "forbidden", message: "no" } }, 403),
    });
    const e = await deleteAccount(...s.args()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).toMatchObject({ code: "forbidden", status: 403 });
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("404 from DELETE /me counts as done (accounts already forgot the DID)", async () => {
    const s = await setup({
      accounts: async () => json({ error: { code: "not_found", message: "no user" } }, 404),
    });
    const res = await deleteAccount(...s.args());
    expect(res.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.tombstoned()).toBe(true);
  });

  it.each([
    ["a framework 404 (no body)", () => new Response("Not Found", { status: 404 })],
    ["a 404 with another error code", () => json({ error: { code: "route_missing", message: "x" } }, 404)],
    ["a 404 with a bare JSON body", () => json({ message: "nope" }, 404)],
  ])(
    "%s at DELETE /me is not 'done': DeleteIncompleteError with stepsDone [], nothing destroyed",
    async (_n, respond) => {
      const s = await setup({ accounts: async () => respond() });
      const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DeleteIncompleteError);
      expect((err as DeleteIncompleteError).pending.stepsDone).toEqual([]);
      expect(s.deleteSubOrganization).not.toHaveBeenCalled();
      expect(s.dir.submitted).toHaveLength(0);
    }
  );

  it("refuses to destroy the wallet when the signed tombstone does not verify", async () => {
    const s = await setup();
    // Signs a different payload: a well-formed signature that is wrong for the tombstone.
    const realSign = s.wallet.sign.getMockImplementation()!;
    s.wallet.sign.mockImplementation(async (p: Uint8Array) => realSign(new Uint8Array([...p, 1])));
    const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).code).toBe("tombstone_signature_invalid");
    // Caught right after signing: accounts was never contacted.
    expect((err as DeleteIncompleteError).pending.stepsDone).toEqual([]);
    expect(s.accounts).not.toHaveBeenCalled();
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("finish(): the head already being our tombstone still verifies it against the earlier entry", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    // The tombstone lands (lost response), then resume runs.
    s.dir.apply(s.did, pending.signedTombstone);
    s.deleteSubOrganization.mockClear();
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    });
    expect(s.deleteSubOrganization).toHaveBeenCalledTimes(1);
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
  });

  it("resumeDelete refuses a tampered stored tombstone before Turnkey", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockClear();
    const bad = {
      ...pending,
      signedTombstone: { ...pending.signedTombstone, sig: "AAAA" },
    };
    await expect(resumeDelete(s.cfg, bad, { turnkeyWithUserStamper: s.turnkey })).rejects.toMatchObject({
      code: "tombstone_signature_invalid",
    });
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a network error",
      async () => {
        throw new TypeError("fetch failed");
      },
      NetworkError,
    ],
    ["a 503", async () => json({ error: { code: "down", message: "x" } }, 503), AccountsError],
  ] as const)("%s at DELETE /me leaves a resumable pending with stepsDone []", async (_n, accounts, causeType) => {
    const s = await setup({ accounts });
    const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    const pending = (err as DeleteIncompleteError).pending;
    expect(pending.stepsDone).toEqual([]);
    expect(pending.signedTombstone.type).toBe("plc_tombstone");
    expect((err as Error).cause).toBeInstanceOf(causeType);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);

    // resume needs a session for step 2 ...
    const noSession = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    }).catch((e: unknown) => e);
    expect(noSession).toBeInstanceOf(UsageError);
    expect((noSession as UsageError).code).toBe("session_required");
    // ... and with one, finishes without signing again.
    s.accounts.mockImplementation(async () => new Response(null, { status: 204 }));
    s.wallet.sign.mockClear();
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
      session: s.session,
    });
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.wallet.sign).not.toHaveBeenCalled();
    expect(s.tombstoned()).toBe(true);
  });

  it("resume from stepsDone [] refuses a session for another DID", async () => {
    const s = await setup({
      accounts: async () => {
        throw new TypeError("offline");
      },
    });
    const pending = ((await deleteAccount(...s.args()).catch((e: unknown) => e)) as DeleteIncompleteError).pending;
    await expect(
      resumeDelete(s.cfg, pending, {
        turnkeyWithUserStamper: s.turnkey,
        session: { ...s.session, did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa" },
      })
    ).rejects.toMatchObject({ code: "session_required" });
  });

  it("head moved between DELETE /me and the Turnkey delete: typed error, wallet kept, and deleteAccount again completes", async () => {
    const s = await setup();
    let first = true;
    s.accounts.mockImplementation(async () => {
      if (first) {
        first = false;
        await moveHead(s);
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: "not_found", message: "gone" } }, 404);
    });
    const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteHeadMovedError);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteHeadMovedError).code).toBe("delete_head_moved");
    expect((err as DeleteHeadMovedError).pending.stepsDone).toEqual(["accounts"]);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);

    const done = await deleteAccount(...s.args());
    expect(done.prevCid).not.toBe((err as DeleteHeadMovedError).pending.prevCid);
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.deleteSubOrganization).toHaveBeenCalledTimes(1);
    expect(s.tombstoned()).toBe(true);
  });
});

describe("resumeDelete", () => {
  it("needs no accounts call and does not re-sign", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.accounts.mockClear();
    s.wallet.sign.mockClear();
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    });
    expect(s.accounts).not.toHaveBeenCalled();
    expect(s.wallet.sign).not.toHaveBeenCalled();
    expect(s.dir.submitted).toEqual([pending.signedTombstone]);
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
  });

  it("re-checks the head before the Turnkey delete and refuses if it moved", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockClear();
    await moveHead(s);
    const err = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteHeadMovedError);
    expect((err as DeleteHeadMovedError).pending.stepsDone).toEqual(["accounts"]);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
  });

  it("skips Turnkey when it is already done", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockClear();
    await resumeDelete(
      s.cfg,
      { ...pending, stepsDone: ["accounts", "turnkey"] },
      { turnkeyWithUserStamper: s.turnkey }
    );
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(1);
  });

  it("a tombstone applied by an earlier attempt whose response was lost counts as done", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.dir.beforeSubmit = (did, op) => {
      s.dir.apply(did, op);
      return json({ error: "gateway timeout" }, 504);
    };
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    });
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.dir.head(s.did).cid).toBe(computeCid(pending.signedTombstone));
  });

  it("resubmitting an already-applied tombstone (Go answers 400 deactivated) counts as done", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.dir.apply(s.did, pending.signedTombstone);
    const done = await resumeDelete(
      s.cfg,
      { ...pending, stepsDone: ["accounts", "turnkey"] },
      { turnkeyWithUserStamper: s.turnkey }
    );
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
  });

  it("a rejection while the head is not this tombstone stays an error (resolve's 410 is not trusted)", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.dir.beforeSubmit = () => json({ error: "bad" }, 400);
    const err = await resumeDelete(
      s.cfg,
      { ...pending, stepsDone: ["accounts", "turnkey"] },
      { turnkeyWithUserStamper: s.turnkey }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).cause).toBeInstanceOf(DirectoryRejectedError);
    expect(s.order).not.toContain("resolve");
  });

  it("a 409 at submit after the Turnkey delete surfaces DeleteHeadMovedError without re-signing", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.wallet.sign.mockClear();
    await moveHead(s);
    const err = await resumeDelete(
      s.cfg,
      { ...pending, stepsDone: ["accounts", "turnkey"] },
      { turnkeyWithUserStamper: s.turnkey }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteHeadMovedError);
    expect((err as DeleteIncompleteError).cause).toBeInstanceOf(HeadMovedError);
    expect(s.wallet.sign).not.toHaveBeenCalled();
  });
});

describe("deleteWithoutExport and an already-deleted sub-org", () => {
  it.each([true, false])("passes deleteWithoutExport=%s to Turnkey", async (flag) => {
    const s = await setup();
    const res = await deleteAccount(...s.args(flag));
    const body = (
      s.deleteSubOrganization.mock.calls[0] as unknown as [{ parameters: { deleteWithoutExport: boolean } }]
    )[0];
    expect(body.parameters.deleteWithoutExport).toBe(flag);
    expect(res.deleteWithoutExport).toBe(flag);
  });

  it("with false, a Turnkey refusal is recoverable by resumeDelete", async () => {
    const s = await setup();
    s.deleteSubOrganization.mockImplementationOnce(async () => {
      throw new TurnkeyRequestError({
        code: 9,
        message: "wallets not exported",
        details: null,
      });
    });
    const err = await deleteAccount(...s.args(false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    const pending = (err as DeleteIncompleteError).pending;
    expect(pending.stepsDone).toEqual(["accounts"]);
    expect(pending.deleteWithoutExport).toBe(false);
    s.accounts.mockClear();
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    });
    const body = (
      s.deleteSubOrganization.mock.calls.at(-1) as unknown as [{ parameters: { deleteWithoutExport: boolean } }]
    )[0];
    expect(body.parameters.deleteWithoutExport).toBe(false);
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.accounts).not.toHaveBeenCalled();
  });

  it("resume treats Turnkey NOT_FOUND as step 3 done and submits the tombstone", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockImplementation(async () => {
      throw new TurnkeyRequestError({
        code: 5,
        message: "organization not found",
        details: null,
      });
    });
    const done = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    });
    expect(s.dir.submitted).toHaveLength(1);
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
  });

  it("resume with another Turnkey error is still incomplete", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockImplementation(async () => {
      throw new TurnkeyRequestError({
        code: 13,
        message: "internal",
        details: null,
      });
    });
    const err = await resumeDelete(s.cfg, pending, {
      turnkeyWithUserStamper: s.turnkey,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect(s.dir.submitted).toHaveLength(0);
  });
});

describe("DeleteIncompleteError.code", () => {
  it("is a union of its literal codes, not string", () => {
    const pending = { stepsDone: [] } as unknown as PendingDeletion;
    const e = new DeleteIncompleteError(pending, "x");
    expectTypeOf(e.code).toEqualTypeOf<"delete_incomplete" | "delete_head_moved" | "tombstone_signature_invalid">();
    expect(e.code).toBe("delete_incomplete");
    expect(new DeleteHeadMovedError(pending, "x").code).toBe("delete_head_moved");
  });
});

describe("deleteAccount only deletes the sub-org that holds the wallet (R6-F3)", () => {
  it("refuses a sub-org without the wallet before signing: nothing forgotten, nothing deleted", async () => {
    const s = await setup();
    const [cfg, opts] = s.args();
    const e = await deleteAccount(cfg, { ...opts, subOrganizationId: OTHER_SUB }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TurnkeyError);
    expect(e).toMatchObject({ code: "sub_org_mismatch" });
    expect((e as Error).message).toContain(OTHER_SUB);
    expect(s.wallet.sign).not.toHaveBeenCalled();
    expect(s.accounts).not.toHaveBeenCalled();
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("resumeDelete re-checks a stored sub-org before deleting it", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    expect(pending.walletAddress).toBe(ethAddressFromDidKey(s.wallet.didKey));
    s.deleteSubOrganization.mockClear();
    s.getWalletAccounts.mockClear();
    const err = await resumeDelete(
      s.cfg,
      { ...pending, subOrganizationId: OTHER_SUB },
      { turnkeyWithUserStamper: s.turnkey }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).cause).toBeInstanceOf(TurnkeyError);
    expect((err as DeleteIncompleteError).cause).toMatchObject({ code: "sub_org_mismatch" });
    expect(s.getWalletAccounts).toHaveBeenCalledWith({ organizationId: OTHER_SUB });
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("resumeDelete refuses a stored walletAddress that is not the tombstone signer's", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockClear();
    const err = await resumeDelete(
      s.cfg,
      { ...pending, subOrganizationId: OTHER_SUB, walletAddress: OTHER_WALLET },
      { turnkeyWithUserStamper: s.turnkey }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).cause).toMatchObject({ code: "sub_org_mismatch" });
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
  });

  it("resumeDelete checks the stored sub-org right before the Turnkey delete", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.order.length = 0;
    await resumeDelete(s.cfg, pending, { turnkeyWithUserStamper: s.turnkey });
    expect(s.order).toEqual(["audit", "wallets", "turnkey", "submit"]);
  });
});

describe("resumeDelete from stepsDone [] checks the sub-org before DELETE /me (fix round 1)", () => {
  /** A pending stopped at DELETE /me (network error), so stepsDone is []. */
  async function pendingBeforeAccounts() {
    const s = await setup({
      accounts: async () => {
        throw new TypeError("offline");
      },
    });
    const pending = ((await deleteAccount(...s.args()).catch((e: unknown) => e)) as DeleteIncompleteError).pending;
    expect(pending.stepsDone).toEqual([]);
    s.accounts.mockReset();
    s.accounts.mockImplementation(async () => new Response(null, { status: 204 }));
    s.order.length = 0;
    return { s, pending };
  }

  it("a wrong stored sub-org forgets nothing and deletes nothing", async () => {
    const { s, pending } = await pendingBeforeAccounts();
    const err = await resumeDelete(
      s.cfg,
      { ...pending, subOrganizationId: OTHER_SUB },
      { turnkeyWithUserStamper: s.turnkey, session: s.session }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).cause).toMatchObject({ code: "sub_org_mismatch" });
    expect((err as DeleteIncompleteError).pending.stepsDone).toEqual([]);
    expect(s.accounts).not.toHaveBeenCalled();
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("a stored walletAddress that is not the tombstone signer's forgets nothing", async () => {
    const { s, pending } = await pendingBeforeAccounts();
    const err = await resumeDelete(
      s.cfg,
      { ...pending, subOrganizationId: OTHER_SUB, walletAddress: OTHER_WALLET },
      { turnkeyWithUserStamper: s.turnkey, session: s.session }
    ).catch((e: unknown) => e);
    expect((err as DeleteIncompleteError).cause).toMatchObject({ code: "sub_org_mismatch" });
    expect(s.accounts).not.toHaveBeenCalled();
  });

  it("the right sub-org: checked once, before DELETE /me, then finishes", async () => {
    const { s, pending } = await pendingBeforeAccounts();
    const done = await resumeDelete(s.cfg, pending, { turnkeyWithUserStamper: s.turnkey, session: s.session });
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.order).toEqual(["audit", "wallets", "accounts", "audit", "turnkey", "submit"]);
  });
});

describe("a PendingDeletion is a bearer credential (R6-F4)", () => {
  it("DeleteIncompleteError keeps pending out of its enumerable fields and its JSON", async () => {
    const s = await setup({ tkFails: true });
    const err = (await deleteAccount(...s.args()).catch((e: unknown) => e)) as DeleteIncompleteError;
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    const sig = err.pending.signedTombstone.sig;
    expect(err.pending.stepsDone).toEqual(["accounts"]);
    expect(Object.keys(err)).not.toContain("pending");
    expect(JSON.stringify(err)).not.toContain(sig);
    expect(JSON.stringify({ ...err })).not.toContain(sig);
    // What error reporters that copy extra error fields (Sentry's ExtraErrorData) collect.
    const extra = Object.fromEntries(Object.entries(err));
    expect(JSON.stringify(extra)).not.toContain(sig);
    expect(err.message).not.toContain(sig);
  });

  it("DeleteHeadMovedError too", () => {
    const pending = { stepsDone: [], signedTombstone: { sig: "SECRET" } } as unknown as PendingDeletion;
    const e = new DeleteHeadMovedError(pending, "x");
    expect(e.pending).toBe(pending);
    expect(Object.keys(e)).not.toContain("pending");
    expect(JSON.stringify(e)).not.toContain("SECRET");
  });
});

// Contract 3 (R8-F8): accounts refuses DELETE /me with 409 sole_org_admin while the caller is
// the only OrgAdmin of an org, with the org DIDs in a body field `orgs` or, failing that, in
// the message. Nothing is deleted: the signed tombstone is dropped, Turnkey and the DID untouched.
describe("DELETE /me 409 sole_org_admin is SoleOrgAdminError (contract 3)", () => {
  const ORG1 = "did:dimo:" + "a".repeat(24);
  const ORG2 = "did:dimo:" + "b2".repeat(12);
  const refuse = (body: unknown) => async () => json(body, 409);

  it.each([
    ["orgs in the error object", { error: { code: "sole_org_admin", message: "only admin", orgs: [ORG1, ORG2] } }],
    ["orgs beside the error object", { error: { code: "sole_org_admin", message: "only admin" }, orgs: [ORG1, ORG2] }],
    [
      "orgs only in the message",
      {
        error: {
          code: "sole_org_admin",
          message: `the account is the only admin of ${ORG1}, ${ORG2}; add another admin first`,
        },
      },
    ],
  ])("%s: typed error with the org DIDs, nothing destroyed", async (_n, body) => {
    const s = await setup({ accounts: refuse(body) });
    const e = await deleteAccount(...s.args()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SoleOrgAdminError);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).not.toBeInstanceOf(DeleteIncompleteError);
    expect(e).toMatchObject({ name: "SoleOrgAdminError", code: "sole_org_admin", status: 409 });
    expect((e as SoleOrgAdminError).orgs).toEqual([ORG1, ORG2]);
    expect((e as Error).message).toMatch(/^sole_org_admin: /);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
    expect(s.tombstoned()).toBe(false);
  });

  it("the body field wins over the message, and keeps only well-formed DIDs, once each", async () => {
    const body = {
      error: { code: "sole_org_admin", message: `only admin of ${ORG2}`, orgs: [ORG1, 7, "did:dimo:short", ORG1] },
    };
    const s = await setup({ accounts: refuse(body) });
    const e = (await deleteAccount(...s.args()).catch((x: unknown) => x)) as SoleOrgAdminError;
    expect(e.orgs).toEqual([ORG1]);
  });

  it("the message is read for exact DIDs only (no prefix of a longer string)", async () => {
    const body = { error: { code: "sole_org_admin", message: `orgs: ${ORG1}a, ${ORG2}.` } };
    const s = await setup({ accounts: refuse(body) });
    const e = (await deleteAccount(...s.args()).catch((x: unknown) => x)) as SoleOrgAdminError;
    expect(e.orgs).toEqual([ORG2]);
  });

  // Fix round 1: every shape accounts might send for `orgs`.
  it.each([
    [
      "{ did } objects in the error object",
      { error: { code: "sole_org_admin", message: "m", orgs: [{ did: ORG1, name: "Acme" }, { did: ORG2 }] } },
    ],
    [
      "{ did } objects beside the error object",
      { error: { code: "sole_org_admin", message: "m" }, orgs: [{ did: ORG1 }, { did: ORG2 }] },
    ],
    [
      "strings and { did } objects mixed",
      { error: { code: "sole_org_admin", message: "m", orgs: [ORG1, { did: ORG2 }] } },
    ],
    [
      "an empty error.orgs, DIDs beside it",
      { error: { code: "sole_org_admin", message: "m", orgs: [] }, orgs: [ORG1, ORG2] },
    ],
    [
      "an orgs field with no usable DID, DIDs in the message",
      {
        error: {
          code: "sole_org_admin",
          message: `only admin of ${ORG1} and ${ORG2}`,
          orgs: ["x", 7, { did: "did:dimo:short" }, { name: "Acme" }, null],
        },
      },
    ],
    [
      "an empty orgs field, DIDs in the message",
      { error: { code: "sole_org_admin", message: `only admin of ${ORG1}, ${ORG2}`, orgs: [] } },
    ],
    [
      "orgs not an array, DIDs in the message",
      { error: { code: "sole_org_admin", message: `only admin of ${ORG1}, ${ORG2}`, orgs: "x" } },
    ],
  ])("%s: orgs are both org DIDs", async (_n, body) => {
    const s = await setup({ accounts: refuse(body) });
    const e = (await deleteAccount(...s.args()).catch((x: unknown) => x)) as SoleOrgAdminError;
    expect(e).toBeInstanceOf(SoleOrgAdminError);
    expect(e.orgs).toEqual([ORG1, ORG2]);
  });

  it("no DIDs anywhere: still SoleOrgAdminError, with orgs []", async () => {
    const s = await setup({ accounts: refuse({ error: { code: "sole_org_admin", message: "only admin" } }) });
    const e = (await deleteAccount(...s.args()).catch((x: unknown) => x)) as SoleOrgAdminError;
    expect(e).toBeInstanceOf(SoleOrgAdminError);
    expect(e.orgs).toEqual([]);
  });

  it("another 409 stays a plain AccountsError", async () => {
    const s = await setup({ accounts: refuse({ error: { code: "conflict", message: "busy" }, orgs: [ORG1] }) });
    const e = await deleteAccount(...s.args()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).not.toBeInstanceOf(SoleOrgAdminError);
    expect(e).toMatchObject({ code: "conflict", status: 409 });
  });

  it("resumeDelete from stepsDone [] surfaces it too, before anything is destroyed", async () => {
    const s = await setup({
      accounts: async () => {
        throw new TypeError("offline");
      },
    });
    const pending = ((await deleteAccount(...s.args()).catch((e: unknown) => e)) as DeleteIncompleteError).pending;
    s.accounts.mockImplementation(refuse({ error: { code: "sole_org_admin", message: "x", orgs: [ORG1] } }));
    const e = await resumeDelete(s.cfg, pending, { turnkeyWithUserStamper: s.turnkey, session: s.session }).catch(
      (x: unknown) => x
    );
    expect(e).toBeInstanceOf(SoleOrgAdminError);
    expect((e as SoleOrgAdminError).orgs).toEqual([ORG1]);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });
});
