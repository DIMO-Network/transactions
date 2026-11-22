import { createActivityPoller, type TurnkeyClient, TurnkeyRequestError } from "@turnkey/http";

import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import {
  buildTombstone,
  computeCid,
  encodeSigningPayload,
  ethAddressFromDidKey,
  type Operation,
  verifyOpSignature,
} from "../core/index.js";
import { type AuditEntry, type DirectoryClient, directoryFor } from "../directory/client.js";
import {
  AccountSdkError,
  AccountsError,
  HeadMovedError,
  NetworkError,
  PolicyError,
  SoleOrgAdminError,
  TurnkeyError,
  UsageError,
} from "../errors.js";
import type { Signer } from "../signers/types.js";
import { isObject } from "./response.js";

export type DeleteStep = "accounts" | "turnkey" | "tombstone";

/**
 * Everything needed to finish a deletion without signing again. It is plain JSON, but it is
 * a bearer credential: `signedTombstone` deactivates the DID for good, for whoever submits
 * it, for as long as the head stays at `prevCid`, even if the user changes their mind.
 * Persist it only on the device (IndexedDB, the platform keystore), never log it, and never
 * send it to a server or an error reporter. DeleteIncompleteError keeps it in a
 * non-enumerable `pending`, so reporters that copy an error's own fields skip it.
 */
export interface PendingDeletion {
  did: string;
  subOrganizationId: string;
  /**
   * The Ethereum address of the DID's wallet (the key that signed the tombstone). The
   * sub-org is deleted only while it holds an Ethereum account with this address.
   */
  walletAddress: `0x${string}`;
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
 * A deletion stopped part-way. `pending` can be persisted (on the device only: it is a
 * bearer credential, see PendingDeletion) and passed to resumeDelete; `cause` is the
 * underlying failure. With stepsDone [] (DELETE /me's outcome unknown), resumeDelete needs
 * a session again. `pending` is non-enumerable, so JSON.stringify and error reporters that
 * copy an error's own enumerable fields leave the signed tombstone out.
 */
export class DeleteIncompleteError extends AccountSdkError {
  declare readonly code: DeleteIncompleteCode;
  declare readonly pending: PendingDeletion;
  constructor(pending: PendingDeletion, cause: unknown, code: DeleteIncompleteCode = "delete_incomplete") {
    super(code, `account deletion incomplete (done: ${pending.stepsDone.join(", ") || "none"}): ${describe(cause)}`, {
      cause,
    });
    this.name = "DeleteIncompleteError";
    Object.defineProperty(this, "pending", { value: pending, enumerable: false, writable: false, configurable: false });
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
  /**
   * Identity token carrying scope `approve`. dauth grants `approve` only to a key that is
   * also a rotation key of the DID, so for a person this session must come from signIn
   * with the wallet (`fragment: "wallet"`); asking for `approve` with a device key fails
   * with KeyNotAllowedError.
   */
  session: Session;
  wallet: Signer;
  /** Defaults to cfg.directoryUrl with cfg.fetchImpl. */
  directory?: DirectoryClient;
  /** Turnkey client stamping with the user's credential (passkey / session key). */
  turnkeyWithUserStamper: TurnkeyClient;
  /** The sub-org that holds the wallet. Checked (getWalletAccounts) before anything is signed. */
  subOrganizationId: string;
  /** Required, no default. See deleteAccount for what each value risks. */
  deleteWithoutExport: boolean;
}

export interface ResumeDeleteOptions {
  turnkeyWithUserStamper: TurnkeyClient;
  /** Defaults to cfg.directoryUrl with cfg.fetchImpl. */
  directory?: DirectoryClient;
  /**
   * Needed only when stepsDone lacks "accounts": a session for pending.did with scope
   * `approve`, signed in with the wallet (`fragment: "wallet"`), as for deleteAccount.
   */
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

const DID_RE = /^did:dimo:[a-z2-7]{24}$/;
const DIDS_IN_TEXT = /did:dimo:[a-z2-7]{24}(?![A-Za-z0-9])/g;

/**
 * The org DIDs of a 409 `sole_org_admin` body: its `orgs` array (in the error object, else
 * beside it), keeping only well-formed DIDs; without one, the DIDs the message names.
 */
function soleAdminOrgs(body: unknown, message: string): string[] {
  const b = isObject(body) ? body : {};
  const e = isObject(b.error) ? b.error : {};
  const field = Array.isArray(e.orgs) ? e.orgs : Array.isArray(b.orgs) ? b.orgs : undefined;
  const dids = field
    ? field.filter((d): d is string => typeof d === "string" && DID_RE.test(d))
    : (message.match(DIDS_IN_TEXT) ?? []);
  return [...new Set(dids)];
}

/** SoleOrgAdminError from DELETE /me's 409 `sole_org_admin` (`err` was read from a clone of `res`). */
async function soleOrgAdmin(res: Response, err: AccountsError): Promise<SoleOrgAdminError> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  const message = err.message.replace(/^sole_org_admin: /, "");
  return new SoleOrgAdminError(err.status, message, soleAdminOrgs(body, message), err.retryAfterSeconds);
}

/**
 * Step 2: DELETE /api/v2/me. 2xx, and a 404 carrying accounts' `{error:{code:"not_found"}}`
 * envelope (nothing left for this DID), count as done. Any other 404, a network error
 * or a 5xx leaves the outcome unknown: DeleteIncompleteError with the step not done.
 * A 409 `sole_org_admin` is SoleOrgAdminError. Any other status is an AccountsError, and
 * in both cases nothing is resumable.
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
    const err = await AccountsError.fromResponse(res.clone());
    if (res.status === 409 && err.code === "sole_org_admin") throw await soleOrgAdmin(res, err);
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

/** The rotation key the tombstone's signature verifies under, if any. */
function tombstoneSigner(tombstone: Operation, rotationKeys: readonly string[]): string | undefined {
  const { sig, ...unsigned } = tombstone;
  const payload = encodeSigningPayload(unsigned);
  return rotationKeys.find((k) => verifyOpSignature(payload, sig, k));
}

/** True when the tombstone's signature verifies under one of `rotationKeys`. */
const tombstoneVerifies = (tombstone: Operation, rotationKeys: readonly string[]): boolean =>
  tombstoneSigner(tombstone, rotationKeys) !== undefined;

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const subOrgMismatch = (subOrganizationId: string, walletAddress: string): TurnkeyError =>
  new TurnkeyError(
    "sub_org_mismatch",
    `sub-organization ${subOrganizationId} holds no Ethereum account ${walletAddress} (this DID's wallet); refusing to delete it`
  );

/**
 * Throw TurnkeyError `sub_org_mismatch` unless the sub-org holds an Ethereum account with
 * the wallet's address. Deleting any other sub-org the stamper can reach (an org's root
 * sub-org, another account) would destroy keys this deletion has nothing to do with.
 */
async function assertHoldsWallet(
  turnkey: TurnkeyClient,
  subOrganizationId: string,
  walletAddress: string
): Promise<void> {
  const { accounts } = await turnkey.getWalletAccounts({ organizationId: subOrganizationId });
  const holds = accounts.some(
    (a) => a.addressFormat === "ADDRESS_FORMAT_ETHEREUM" && sameAddress(a.address, walletAddress)
  );
  if (!holds) throw subOrgMismatch(subOrganizationId, walletAddress);
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

/**
 * The checks that guard the Turnkey delete, against the verified `log`: the tombstone's
 * signature verifies under a rotation key of the state it was signed against (else
 * `tombstone_signature_invalid`), `pending.walletAddress` is that key's address, and, when
 * `checkTurnkey`, the stored sub-org holds an Ethereum account with it (else cause
 * TurnkeyError `sub_org_mismatch`). Throws DeleteIncompleteError carrying `pending`.
 */
async function assertPendingSubOrg(
  pending: PendingDeletion,
  log: readonly AuditEntry[],
  turnkey: TurnkeyClient,
  checkTurnkey: boolean
): Promise<void> {
  const signedAgainst = log.find((e) => e.cid === pending.prevCid);
  const signer = signedAgainst && tombstoneSigner(pending.signedTombstone, signedAgainst.operation.rotationKeys);
  if (!signer) throw badTombstone(pending);
  try {
    if (!sameAddress(ethAddressFromDidKey(signer), pending.walletAddress)) {
      throw subOrgMismatch(pending.subOrganizationId, pending.walletAddress);
    }
    if (checkTurnkey) await assertHoldsWallet(turnkey, pending.subOrganizationId, pending.walletAddress);
  } catch (err) {
    throw new DeleteIncompleteError(pending, err);
  }
}

/**
 * Steps 3 and 4. Skips what stepsDone records. Never calls accounts and never signs.
 * `subOrgChecked`: the caller checked moments ago that the sub-org holds the wallet
 * (deleteAccount, or resumeDelete before DELETE /me), so step 3 skips the second
 * getWalletAccounts (one passkey prompt fewer).
 */
async function finish(
  pending: PendingDeletion,
  turnkey: TurnkeyClient,
  directory: DirectoryClient,
  subOrgChecked = false
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
    // Never destroy the wallet for a tombstone that cannot apply, nor a sub-org that does
    // not hold the wallet that signed it.
    await assertPendingSubOrg(snapshot(), log, turnkey, !subOrgChecked);
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
 * `opts.session` must carry scope `approve`, which dauth grants only to a rotation key:
 * sign in with the wallet (`fragment: "wallet"`), not a device key.
 *
 * Delete the account, in the spec §6.6 order:
 * 0. check that `subOrganizationId` holds an Ethereum account with the wallet's address
 *    (TurnkeyError `sub_org_mismatch` otherwise, before anything is signed or forgotten);
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
 * nothing happened, so start over. While the account is the only admin of an org, that is
 * SoleOrgAdminError (409 `sole_org_admin`, `orgs` lists the org DIDs): give each org
 * another admin first.
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
  // 0. The sub-org must hold this wallet, before anything is signed or forgotten.
  const walletAddress = ethAddressFromDidKey(wallet.didKey);
  await assertHoldsWallet(opts.turnkeyWithUserStamper, opts.subOrganizationId, walletAddress);
  // 1. Sign, don't submit.
  const unsigned = buildTombstone(prevCid);
  const signedTombstone: Operation = {
    ...unsigned,
    sig: await wallet.sign(encodeSigningPayload(unsigned)),
  };
  const initial: PendingDeletion = {
    did,
    subOrganizationId: opts.subOrganizationId,
    walletAddress,
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
  return finish(pending, opts.turnkeyWithUserStamper, directory, true);
}

/**
 * Finish a saved PendingDeletion (with its stored deleteWithoutExport). Never signs.
 * While stepsDone lacks "turnkey" it checks again that the stored sub-org holds an
 * Ethereum account with `pending.walletAddress`, and that this is the address of the key
 * that signed the tombstone (else DeleteIncompleteError, cause TurnkeyError
 * `sub_org_mismatch`): before DELETE /me when that step is still to do, so a wrong sub-org
 * makes accounts forget nothing, and otherwise before the Turnkey delete.
 * Calls accounts only when stepsDone lacks "accounts", and then needs `opts.session`
 * (for pending.did, scope `approve`); without one it throws UsageError
 * `session_required`, and calling deleteAccount again also works. DELETE /me's 409
 * `sole_org_admin` is SoleOrgAdminError, as in deleteAccount; `pending` is unchanged.
 */
export async function resumeDelete(
  cfg: SdkConfig,
  pending: PendingDeletion,
  opts: ResumeDeleteOptions
): Promise<PendingDeletion> {
  const directory = directoryFor(cfg, opts.directory);
  const turnkey = opts.turnkeyWithUserStamper;
  let state = pending;
  let subOrgChecked = false;
  if (!state.stepsDone.includes("accounts")) {
    const { session } = opts;
    if (!session || session.did !== pending.did) {
      throw new UsageError(
        "session_required",
        "DELETE /api/v2/me has not completed: pass a session for this DID with scope 'approve' (or call deleteAccount again)"
      );
    }
    requireScopes(session, ["approve"], "account deletion");
    // A wrong sub-org must be refused before accounts forgets anything, not after.
    if (!state.stepsDone.includes("turnkey")) {
      let log: AuditEntry[];
      try {
        log = await directory.auditLog(state.did);
      } catch (err) {
        throw new DeleteIncompleteError(state, err);
      }
      await assertPendingSubOrg(state, log, turnkey, true);
      subOrgChecked = true;
    }
    state = await forgetAccount(cfg, session, state);
  }
  return finish(state, turnkey, directory, subOrgChecked);
}
