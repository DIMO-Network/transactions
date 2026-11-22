import type { DpopKey } from "../auth/dpop.js";
import { authedFetch } from "../auth/fetch.js";
import { type Scope, type Session, signIn } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import {
  assertPersonDid,
  buildAddKey,
  buildGenesis,
  computeCid,
  deriveDid,
  encodeSigningPayload,
  type Operation,
  type UnsignedOperation,
} from "../core/index.js";
import { type AuditEntry, type DirectoryClient, directoryFor } from "../directory/client.js";
import {
  AccountsError,
  DeactivatedError,
  DidExistsError,
  DidNotFoundError,
  DirectoryRejectedError,
  UnexpectedDidStateError,
  UsageError,
} from "../errors.js";
import type { Signer } from "../signers/types.js";
import { type AccountView, getMe, isAccountView } from "./accounts.js";
import { addDeviceKey, proveKey } from "./keys.js";
import { accountsJson } from "./response.js";

/**
 * Create the person DID, sign in with the wallet key, and link the DID to the account via
 * PUT /api/v2/me/did. Returns the DID, the session (scopes `read` and `write`, so the
 * caller can use it straight away) and the account. `opts.scope` may widen the session but
 * must include `read` and `write` (UsageError `scope_missing`, thrown before anything is
 * sent).
 *
 * The genesis is always wallet-only (`{ wallet }`, the wallet as the only rotation key, no
 * services, no aliases): accounts links nothing else, because whoever could sign with the
 * wallet before the claim (for a v1 account, DIMO's Turnkey key) could have put any other
 * key there. With a `signingKey`, claimDid:
 * 1. builds and submits the wallet-only genesis (the signing key first proves possession,
 *    PolicyError `proof_invalid` before the wallet signs anything);
 * 2. signs in with `#wallet` and sends PUT /api/v2/me/did with no body;
 * 3. once the link succeeded (DIMO is off the root, so only the user can sign with the
 *    wallet), adds `#signing` with a wallet-signed key update (addDeviceKey).
 * If step 3 fails, the DID is already linked: call claimDid again with the same arguments
 * and it finishes adding the key.
 *
 * PUT answering 503 `unavailable` is retried up to 3 times, honouring Retry-After.
 * Safe to repeat: if the genesis already exists, the DID is reused only when its verified
 * audit log is that genesis alone, or the genesis plus the very `#signing` update step 3
 * makes for this `signingKey` (a repeat after step 3's answer was lost; the link is then
 * confirmed with GET /api/v2/me, and an account without this DID is refused). Any other
 * log (an added key, new rotation keys, aliases, a genesis that is not wallet-only) throws
 * UnexpectedDidStateError listing what is there, before signing in. If PUT answers 409 but
 * GET /api/v2/me already shows this DID, that is success. Every request uses cfg.fetchImpl.
 */
export async function claimDid(
  cfg: SdkConfig,
  args: {
    wallet: Signer;
    signingKey?: Signer;
    dpopKey: DpopKey;
    directory?: DirectoryClient;
    scope?: Scope[];
  }
): Promise<{ did: string; session: Session; account: AccountView }> {
  const { wallet, signingKey, dpopKey } = args;
  const scope: Scope[] = args.scope ?? ["read", "write"];
  if (!scope.includes("read") || !scope.includes("write")) {
    throw new UsageError(
      "scope_missing",
      "claimDid needs a session with scopes 'read' and 'write' (write for PUT /me/did, read for the 409 fallback and the caller's next GET /me)"
    );
  }
  const directory = directoryFor(cfg, args.directory);
  const genesis = buildGenesis({ walletKey: wallet.didKey });
  const did = deriveDid(genesis);
  const payload = encodeSigningPayload(genesis);
  // Fail fast: a signing key that cannot prove possession stops everything before the
  // wallet signs (step 3 proves it again over the key update it co-signs).
  if (signingKey) await proveKey(signingKey, payload);
  const op: Operation = { ...genesis, sig: await wallet.sign(payload) };
  let signingAlreadyAdded = false;
  try {
    await directory.submit(did, op);
  } catch (err) {
    // An existing DID answers 409 on create, or 400 when the directory takes the genesis
    // for an update. Either way, only a verified audit log for this DID proves it exists.
    const maybeExists = err instanceof DidExistsError || (err instanceof DirectoryRejectedError && err.status === 400);
    if (!maybeExists) throw err;
    let log: AuditEntry[];
    try {
      log = await directory.auditLog(did);
    } catch (headErr) {
      if (headErr instanceof DidNotFoundError) throw err;
      throw headErr;
    }
    signingAlreadyAdded = assertClaimable(did, log, genesis, wallet.didKey, signingKey?.didKey);
  }

  const session = await signIn(cfg, {
    did,
    signer: wallet,
    fragment: "wallet",
    scope,
    dpopKey,
  });
  let account: AccountView;
  if (signingAlreadyAdded) {
    // An earlier claimDid linked the DID and added #signing, and only its answer was lost.
    // accounts would refuse a PUT for this log, so confirm the link instead.
    const me = await getMe(cfg, { session });
    if (me?.did !== did) {
      throw new UnexpectedDidStateError(did, {
        unexpectedKeys: {},
        rotationKeys: [wallet.didKey],
        operations: 2,
      });
    }
    account = me;
  } else {
    account = await link(cfg, session, did);
  }
  if (signingKey) {
    // Step 3, only after the link. Idempotent: a key already on the head is not re-added.
    await addDeviceKey(cfg, { did, wallet, newKey: signingKey, fragment: "signing", directory });
  }
  return { did, session, account };
}

/** PUT /api/v2/me/did (no body), with the 503 retries and the 409-already-linked fallback. */
async function link(cfg: SdkConfig, session: Session, did: string): Promise<AccountView> {
  const call = authedFetch(cfg, session);
  const url = `${normalizeUrl(cfg.accountsUrl)}/api/v2/me/did`;
  let res = await call(url, { method: "PUT" });
  // Directory propagation can lag right after submit: accounts answers 503 `unavailable`
  // ("DID not visible yet; retry") with Retry-After. Retry a few times.
  for (let retry = 0; retry < LINK_RETRIES && res.status === 503; retry++) {
    const err = await AccountsError.fromResponse(res.clone());
    if (err.code !== "unavailable") break;
    await sleep(retryDelayMs(err.retryAfterSeconds));
    res = await call(url, { method: "PUT" });
  }
  if (res.ok) return accountsJson<AccountView>(res, isAccountView);
  const err = await AccountsError.fromResponse(res);
  // 409: the account may already carry this DID (a retried claim whose response was lost).
  if (res.status === 409) {
    const account = await linkedAccount(cfg, session);
    if (account?.did === did) return account;
  }
  throw err;
}

/** The fragment-to-key entries of `vms` that `expected` does not have. */
const extraKeys = (
  vms: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(Object.entries(vms).filter(([f, key]) => !Object.hasOwn(expected, f) || expected[f] !== key));

/**
 * The existing DID must be what claimDid itself makes: the wallet-only genesis alone, or
 * that genesis plus the `#signing` update step 3 makes for `signingKey` (returns true
 * then). Anything else may have been signed by someone else who could use the wallet
 * before the claim, and is refused (UnexpectedDidStateError) before signing in.
 */
function assertClaimable(
  did: string,
  log: readonly AuditEntry[],
  genesis: UnsignedOperation,
  walletKey: string,
  signingKey: string | undefined
): boolean {
  const head = log.at(-1)!.operation;
  if (head.type === "plc_tombstone") throw new DeactivatedError(did);
  const genesisCid = computeCid(genesis);
  const bareGenesis = log.length === 1 && log[0]!.cid === genesisCid;
  const ownSigningUpdate =
    signingKey !== undefined &&
    log.length === 2 &&
    log[0]!.cid === genesisCid &&
    log[1]!.cid === computeCid(buildAddKey(genesis, genesisCid, signingKey, "signing").op);
  if (!bareGenesis && !ownSigningUpdate) {
    const expectedHead = { ...genesis.verificationMethods, ...(signingKey ? { signing: signingKey } : {}) };
    const unexpectedKeys = {
      ...extraKeys(log[0]!.operation.verificationMethods, genesis.verificationMethods),
      ...extraKeys(head.verificationMethods, expectedHead),
    };
    throw new UnexpectedDidStateError(did, { unexpectedKeys, rotationKeys: head.rotationKeys, operations: log.length });
  }
  assertPersonDid(head, walletKey);
  return ownSigningUpdate;
}

const LINK_RETRIES = 3;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 5000;

/** The AccountsError's Retry-After (integer seconds, else 1 s), capped at 5 s. */
const retryDelayMs = (seconds: number | undefined): number =>
  seconds === undefined ? DEFAULT_RETRY_MS : Math.min(seconds * 1000, MAX_RETRY_MS);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** GET /api/v2/me's account, or undefined when it cannot be read. */
async function linkedAccount(cfg: SdkConfig, session: Session): Promise<AccountView | undefined> {
  try {
    return (await getMe(cfg, { session })) ?? undefined;
  } catch {
    return undefined;
  }
}
