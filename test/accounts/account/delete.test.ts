import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { TurnkeyRequestError, type TurnkeyClient } from "@turnkey/http";
import {
  buildSetAliases,
  computeCid,
  encodeSigningPayload,
  toChecksumAddress,
  verifyOpSignature,
} from "../../src/core/index.js";
import { generateDpopKey } from "../../src/auth/dpop.js";
import type { Session } from "../../src/auth/signin.js";
import {
  AccountsError,
  DeactivatedError,
  DirectoryRejectedError,
  HeadMovedError,
  NetworkError,
  UsageError,
} from "../../src/errors.js";
import {
  deleteAccount,
  resumeDelete,
  DeleteHeadMovedError,
  DeleteIncompleteError,
  type PendingDeletion,
} from "../../src/account/delete.js";
import {
  FakeDirectory,
  cfgFor,
  json,
  k1Signer,
  router,
  type Handler,
} from "../helpers.js";

const ACCOUNTS = "https://accounts.test";
const SUB = "sub-org-1";
const completed = async () => ({
  activity: { id: "a", status: "ACTIVITY_STATUS_COMPLETED", result: {} },
});

async function setup(
  opts: {
    scopes?: string[];
    tkFails?: boolean;
    accounts?: Handler;
  } = {},
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
  const accounts = vi.fn<Handler>(
    opts.accounts ?? (async () => new Response(null, { status: 204 })),
  );
  const fetchImpl = router({
    [dir.base]: async (url, init) => {
      order.push(
        init.method === "POST"
          ? "submit"
          : url.endsWith("/log/audit")
            ? "audit"
            : "resolve",
      );
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
  const turnkey = { deleteSubOrganization } as unknown as TurnkeyClient;
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
    buildSetAliases(head, cid, [
      "did:ethr:137:" + toChecksumAddress("0x" + "ab".repeat(20)),
    ]),
  );

describe("deleteAccount", () => {
  it("order: head, sign tombstone, DELETE /me, re-check head, Turnkey delete, submit tombstone", async () => {
    const s = await setup();
    const prev = s.dir.head(s.did).cid;
    const res = await deleteAccount(...s.args());
    expect(s.order).toEqual([
      "audit",
      "sign",
      "accounts",
      "audit",
      "turnkey",
      "submit",
    ]);
    expect(s.wallet.sign).toHaveBeenCalledTimes(1);
    const [url, init] = s.accounts.mock.calls[0]!;
    expect(url).toBe(`${ACCOUNTS}/api/v2/me`);
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("Authorization")).toBe("DPoP tok");
    const op = s.dir.submitted[0]!;
    expect(op.prev).toBe(prev);
    const { sig, ...unsigned } = op;
    expect(
      verifyOpSignature(encodeSigningPayload(unsigned), sig, s.wallet.didKey),
    ).toBe(true);
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
    await expect(deleteAccount(...s.args())).rejects.toBeInstanceOf(
      DeactivatedError,
    );
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
      accounts: async () =>
        json({ error: { code: "forbidden", message: "no" } }, 403),
    });
    const e = await deleteAccount(...s.args()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AccountsError);
    expect(e).toMatchObject({ code: "forbidden", status: 403 });
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);
  });

  it("404 from DELETE /me counts as done (accounts already forgot the DID)", async () => {
    const s = await setup({
      accounts: async () =>
        json({ error: { code: "not_found", message: "no user" } }, 404),
    });
    const res = await deleteAccount(...s.args());
    expect(res.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
    expect(s.tombstoned()).toBe(true);
  });

  it.each([
    [
      "a framework 404 (no body)",
      () => new Response("Not Found", { status: 404 }),
    ],
    [
      "a 404 with another error code",
      () => json({ error: { code: "route_missing", message: "x" } }, 404),
    ],
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
    },
  );

  it("refuses to destroy the wallet when the signed tombstone does not verify", async () => {
    const s = await setup();
    // Signs a different payload: a well-formed signature that is wrong for the tombstone.
    const realSign = s.wallet.sign.getMockImplementation()!;
    s.wallet.sign.mockImplementation(async (p: Uint8Array) =>
      realSign(new Uint8Array([...p, 1])),
    );
    const err = await deleteAccount(...s.args()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).code).toBe(
      "tombstone_signature_invalid",
    );
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
    await expect(
      resumeDelete(s.cfg, bad, { turnkeyWithUserStamper: s.turnkey }),
    ).rejects.toMatchObject({ code: "tombstone_signature_invalid" });
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
    [
      "a 503",
      async () => json({ error: { code: "down", message: "x" } }, 503),
      AccountsError,
    ],
  ] as const)(
    "%s at DELETE /me leaves a resumable pending with stepsDone []",
    async (_n, accounts, causeType) => {
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
      s.accounts.mockImplementation(
        async () => new Response(null, { status: 204 }),
      );
      s.wallet.sign.mockClear();
      const done = await resumeDelete(s.cfg, pending, {
        turnkeyWithUserStamper: s.turnkey,
        session: s.session,
      });
      expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
      expect(s.wallet.sign).not.toHaveBeenCalled();
      expect(s.tombstoned()).toBe(true);
    },
  );

  it("resume from stepsDone [] refuses a session for another DID", async () => {
    const s = await setup({
      accounts: async () => {
        throw new TypeError("offline");
      },
    });
    const pending = (
      (await deleteAccount(...s.args()).catch(
        (e: unknown) => e,
      )) as DeleteIncompleteError
    ).pending;
    await expect(
      resumeDelete(s.cfg, pending, {
        turnkeyWithUserStamper: s.turnkey,
        session: { ...s.session, did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa" },
      }),
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
    expect((err as DeleteHeadMovedError).pending.stepsDone).toEqual([
      "accounts",
    ]);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
    expect(s.dir.submitted).toHaveLength(0);

    const done = await deleteAccount(...s.args());
    expect(done.prevCid).not.toBe(
      (err as DeleteHeadMovedError).pending.prevCid,
    );
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
    expect((err as DeleteHeadMovedError).pending.stepsDone).toEqual([
      "accounts",
    ]);
    expect(s.deleteSubOrganization).not.toHaveBeenCalled();
  });

  it("skips Turnkey when it is already done", async () => {
    const s = await setup({ tkFails: true });
    const pending = await pendingAfterTkFailure(s);
    s.deleteSubOrganization.mockClear();
    await resumeDelete(
      s.cfg,
      { ...pending, stepsDone: ["accounts", "turnkey"] },
      { turnkeyWithUserStamper: s.turnkey },
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
      { turnkeyWithUserStamper: s.turnkey },
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
      { turnkeyWithUserStamper: s.turnkey },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteIncompleteError);
    expect((err as DeleteIncompleteError).cause).toBeInstanceOf(
      DirectoryRejectedError,
    );
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
      { turnkeyWithUserStamper: s.turnkey },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeleteHeadMovedError);
    expect((err as DeleteIncompleteError).cause).toBeInstanceOf(HeadMovedError);
    expect(s.wallet.sign).not.toHaveBeenCalled();
  });
});

describe("deleteWithoutExport and an already-deleted sub-org", () => {
  it.each([true, false])(
    "passes deleteWithoutExport=%s to Turnkey",
    async (flag) => {
      const s = await setup();
      const res = await deleteAccount(...s.args(flag));
      const body = (
        s.deleteSubOrganization.mock.calls[0] as unknown as [
          { parameters: { deleteWithoutExport: boolean } },
        ]
      )[0];
      expect(body.parameters.deleteWithoutExport).toBe(flag);
      expect(res.deleteWithoutExport).toBe(flag);
    },
  );

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
      s.deleteSubOrganization.mock.calls.at(-1) as unknown as [
        { parameters: { deleteWithoutExport: boolean } },
      ]
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
    expectTypeOf(e.code).toEqualTypeOf<
      "delete_incomplete" | "delete_head_moved" | "tombstone_signature_invalid"
    >();
    expect(e.code).toBe("delete_incomplete");
    expect(new DeleteHeadMovedError(pending, "x").code).toBe(
      "delete_head_moved",
    );
  });
});
