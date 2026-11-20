import { createActivityPoller, type TurnkeyClient, TurnkeyRequestError } from "@turnkey/http";

import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import { buildTombstone, computeCid, encodeSigningPayload, type Operation, verifyOpSignature } from "../core/index.js";
import { type AuditEntry, type DirectoryClient, directoryFor } from "../directory/client.js";
import { AccountSdkError, AccountsError, HeadMovedError, NetworkError, PolicyError, UsageError } from "../errors.js";
import type { Signer } from "../signers/types.js";

export type DeleteStep = "accounts" | "turnkey" | "tombstone";

/** Everything needed to finish a deletion without signing again. Safe to persist (JSON). */
export interface PendingDeletion {
  did: string;
  subOrganizationId: string;
  signedTombstone: Operation;
  /** The head cid the tombstone was signed against. */
  prevCid: string;
  stepsDone: DeleteStep[];
  /** Passed to Turnkey on every (re)try of the sub-org deletion. */
  deleteWithoutExport: boolean;
}

const describe = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export type DeleteIncompleteCode = "delete_incomplete" | "delete_head_moved" | "tombstone_signature_invalid";

/**
 * A deletion stopped part-way. `pending` can be persisted and passed to resumeDelete;
 * `cause` is the underlying failure. With stepsDone [] (DELETE /me's outcome unknown),
 * resumeDelete needs a session again.
 */
export class DeleteIncompleteError extends AccountSdkError {
  declare readonly code: DeleteIncompleteCode;
  readonly pending: PendingDeletion;
  constructor(pending: PendingDeletion, cause: unknown, code: DeleteIncompleteCode = "delete_incomplete") {
    super(code, `account deletion incomplete (done: ${pending.stepsDone.join(", ") || "none"}): ${describe(cause)}`, {
      cause,
    });
    this.name = "DeleteIncompleteError";
    this.pending = pending;
  }
}

/**
 * The DID's head is no longer the one the tombstone was signed against: something else
 * wrote to the DID. The SDK never re-signs. Thrown before the Turnkey sub-org is deleted
 * whenever the move is visible then, so the wallet still exists: call deleteAccount again
 * (DELETE /me answers 204 idempotently when the account is already gone, so the flow
 * continues and signs a new tombstone against the new head).
 */
export class DeleteHeadMovedError extends DeleteIncompleteError {
  constructor(pending: PendingDeletion, cause: unknown) {
    super(pending, cause, "delete_head_moved");
    this.name = "DeleteHeadMovedError";
  }
}

export interface DeleteAccountOptions {
  /** Identity token carrying scope `approve`. */
  session: Session;
  wallet: Signer;
  /** Defaults to cfg.directoryUrl with cfg.fetchImpl. */
  directory?: DirectoryClient;
  /** Turnkey client stamping with the user's credential (passkey / session key). */
  turnkeyWithUserStamper: TurnkeyClient;
  subOrganizationId: string;
  /** Required, no default. See deleteAccount for what each value risks. */
  deleteWithoutExport: boolean;
}

export interface ResumeDeleteOptions {
  turnkeyWithUserStamper: TurnkeyClient;
  /** Defaults to cfg.directoryUrl with cfg.fetchImpl. */
  directory?: DirectoryClient;
  /** Needed only when stepsDone lacks "accounts": a session for pending.did with scope `approve`. */
  session?: Session;
}

const GRPC_NOT_FOUND = 5;

/** Turnkey says the sub-org is gone (gRPC NOT_FOUND): an earlier delete went through. */
function isOrgGone(err: unknown): boolean {
  if (err instanceof TurnkeyRequestError) return err.code === GRPC_NOT_FOUND;
  // @turnkey/http is a peer dependency, but an app can still bundle a second copy (a
  // nested version under another Turnkey package), and then instanceof fails.
  const e = err as { name?: unknown; code?: unknown } | null;
  return e?.name === "TurnkeyRequestError" && e.code === GRPC_NOT_FOUND;
}

async function deleteSubOrg(
  turnkey: TurnkeyClient,
  subOrganizationId: string,
  deleteWithoutExport: boolean
): Promise<void> {
  const poller = createActivityPoller({
    client: turnkey,
    requestFn: turnkey.deleteSubOrganization,
  });
  await poller({
    type: "ACTIVITY_TYPE_DELETE_SUB_ORGANIZATION",
    timestampMs: String(Date.now()),
    organizationId: subOrganizationId,
    parameters: { deleteWithoutExport },
  });
}

/**
 * Step 2: DELETE /api/v2/me. 2xx, and a 404 carrying accounts' `{error:{code:"not_found"}}`
 * envelope (nothing left for this DID), count as done. Any other 404, a network error
 * or a 5xx leaves the outcome unknown: DeleteIncompleteError with the step not done.
 * Any other status is an AccountsError and nothing is resumable.
 */
async function forgetAccount(cfg: SdkConfig, session: Session, pending: PendingDeletion): Promise<PendingDeletion> {
  let res: Response;
  try {
    res = await authedFetch(cfg, session)(`${normalizeUrl(cfg.accountsUrl)}/api/v2/me`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof NetworkError) throw new DeleteIncompleteError(pending, err);
    throw err;
  }
  if (!res.ok) {
    const err = await AccountsError.fromResponse(res);
    // Only accounts' own envelope means "nothing left for this DID". A framework 404 or a
    // wrong accountsUrl proves nothing: the account may still hold the email.
    if (res.status === 404) {
      if (err.code === "not_found") {
        return { ...pending, stepsDone: [...pending.stepsDone, "accounts"] };
      }
      throw new DeleteIncompleteError(pending, err);
    }
    if (res.status >= 500) throw new DeleteIncompleteError(pending, err);
    throw err;
  }
  return { ...pending, stepsDone: [...pending.stepsDone, "accounts"] };
}

/** True when the verified log already ends with this tombstone. */
async function tombstoneApplied(directory: DirectoryClient, did: string, tombstoneCid: string): Promise<boolean> {
  try {
    return (await directory.auditLog(did)).at(-1)!.cid === tombstoneCid;
  } catch {
    return false;
  }
}

/** True when the tombstone's signature verifies under one of `rotationKeys`. */
function tombstoneVerifies(tombstone: Operation, rotationKeys: readonly string[]): boolean {
  const { sig, ...unsigned } = tombstone;
  const payload = encodeSigningPayload(unsigned);
  return rotationKeys.some((k) => verifyOpSignature(payload, sig, k));
}

const badTombstone = (pending: PendingDeletion): DeleteIncompleteError =>
  new DeleteIncompleteError(
    pending,
    new PolicyError(
      "proof_invalid",
      "the signed tombstone does not verify under a rotation key of the head it was signed against"
    ),
    "tombstone_signature_invalid"
  );

/** Steps 3 and 4. Skips what stepsDone records. Never calls accounts and never signs. */
async function finish(
  pending: PendingDeletion,
  turnkey: TurnkeyClient,
  directory: DirectoryClient
): Promise<PendingDeletion> {
  const state: PendingDeletion = {
    ...pending,
    stepsDone: [...pending.stepsDone],
  };
  const snapshot = (): PendingDeletion => ({
    ...state,
    stepsDone: [...state.stepsDone],
  });
  const tombstoneCid = computeCid(state.signedTombstone);

  if (!state.stepsDone.includes("turnkey")) {
    // Never destroy the wallet unless the tombstone can still apply: the head must be the
    // one it was signed against (or already be this very tombstone).
    let log: AuditEntry[];
    let headCid: string;
    try {
      log = await directory.auditLog(state.did);
      headCid = log.at(-1)!.cid;
    } catch (err) {
      throw new DeleteIncompleteError(snapshot(), err);
    }
    if (headCid !== state.prevCid && headCid !== tombstoneCid) {
      throw new DeleteHeadMovedError(
        snapshot(),
        new HeadMovedError(`head is ${headCid}; the tombstone was signed against ${state.prevCid}`)
      );
    }
    // Never destroy the wallet for a tombstone that cannot apply: its signature must
    // verify under a rotation key of the state it was signed against.
    const signedAgainst = log.find((e) => e.cid === state.prevCid);
    if (!signedAgainst || !tombstoneVerifies(state.signedTombstone, signedAgainst.operation.rotationKeys)) {
      throw badTombstone(snapshot());
    }
    try {
      await deleteSubOrg(turnkey, state.subOrganizationId, state.deleteWithoutExport);
    } catch (err) {
      // A lost response to an earlier attempt: the sub-org is already gone.
      if (!isOrgGone(err)) throw new DeleteIncompleteError(snapshot(), err);
    }
    state.stepsDone.push("turnkey");
  }

  if (!state.stepsDone.includes("tombstone")) {
    try {
      await directory.submit(state.did, state.signedTombstone);
    } catch (err) {
      // Applied only if the verified head is this exact tombstone (a lost response, or a
      // 400 "deactivated" on resubmission). did-directory's resolve answers 410 for any
      // document error, so it proves nothing.
      if (!(await tombstoneApplied(directory, state.did, tombstoneCid))) {
        throw err instanceof HeadMovedError
          ? new DeleteHeadMovedError(snapshot(), err)
          : new DeleteIncompleteError(snapshot(), err);
      }
    }
    state.stepsDone.push("tombstone");
  }
  return state;
}

/**
 * Delete the account, in the spec §6.6 order:
 * 1. sign the tombstone (once) against the verified head;
 * 2. DELETE /api/v2/me (204, or a 404 with accounts' not_found envelope, counts as done);
 * 3. delete the Turnkey sub-org, only after re-reading the head and finding it unchanged;
 * 4. submit the tombstone.
 *
 * `deleteWithoutExport` is required. With `false`, Turnkey refuses unless the wallets and
 * keys were exported; you get a DeleteIncompleteError. Recoverable: export the keys, then
 * call resumeDelete. With `true`, the keys and every asset they control (including the
 * smart account's keys) are lost forever.
 *
 * Returns the completed PendingDeletion. A failure after signing throws
 * DeleteIncompleteError (or DeleteHeadMovedError) carrying a PendingDeletion for
 * resumeDelete. A DELETE /me that fails with a 4xx other than 404 throws AccountsError:
 * nothing happened, so start over.
 */
export async function deleteAccount(cfg: SdkConfig, opts: DeleteAccountOptions): Promise<PendingDeletion> {
  const { session, wallet } = opts;
  requireScopes(session, ["approve"], "account deletion");
  const directory = directoryFor(cfg, opts.directory);
  const did = session.did;
  const { cid: prevCid, op: headOp } = await directory.head(did);
  if (!headOp.rotationKeys.includes(wallet.didKey)) {
    throw new PolicyError("rotation_locked", "wallet is not a rotation key of this DID");
  }
  // 1. Sign, don't submit.
  const unsigned = buildTombstone(prevCid);
  const signedTombstone: Operation = {
    ...unsigned,
    sig: await wallet.sign(encodeSigningPayload(unsigned)),
  };
  const initial: PendingDeletion = {
    did,
    subOrganizationId: opts.subOrganizationId,
    signedTombstone,
    prevCid,
    stepsDone: [],
    deleteWithoutExport: opts.deleteWithoutExport,
  };
  // A bad signature must be caught before accounts forgets anything.
  if (!tombstoneVerifies(signedTombstone, headOp.rotationKeys)) throw badTombstone(initial);
  // 2. Accounts forgets the email, while the identity token still works.
  const pending = await forgetAccount(cfg, session, initial);
  // 3 and 4.
  return finish(pending, opts.turnkeyWithUserStamper, directory);
}

/**
 * Finish a saved PendingDeletion (with its stored deleteWithoutExport). Never signs.
 * Calls accounts only when stepsDone lacks "accounts", and then needs `opts.session`
 * (for pending.did, scope `approve`); without one it throws UsageError
 * `session_required`, and calling deleteAccount again also works.
 */
export async function resumeDelete(
  cfg: SdkConfig,
  pending: PendingDeletion,
  opts: ResumeDeleteOptions
): Promise<PendingDeletion> {
  const directory = directoryFor(cfg, opts.directory);
  let state = pending;
  if (!state.stepsDone.includes("accounts")) {
    const { session } = opts;
    if (!session || session.did !== pending.did) {
      throw new UsageError(
        "session_required",
        "DELETE /api/v2/me has not completed: pass a session for this DID with scope 'approve' (or call deleteAccount again)"
      );
    }
    requireScopes(session, ["approve"], "account deletion");
    state = await forgetAccount(cfg, session, state);
  }
  return finish(state, opts.turnkeyWithUserStamper, directory);
}
