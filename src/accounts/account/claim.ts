import type { DpopKey } from "../auth/dpop.js";
import { authedFetch } from "../auth/fetch.js";
import { type Scope, type Session, signIn } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig } from "../config.js";
import {
  assertPersonDid,
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
import { proveKey } from "./keys.js";
import { accountsJson } from "./response.js";

/**
 * Create the person DID (wallet = rotation key, plus an optional device signing key that
 * must prove possession by co-signing the genesis), sign in with the wallet key, and link
 * the DID to the account via PUT /api/v2/me/did. With a signing key the PUT body is
 * `{ signingKey: <its did:key> }`: accounts links a genesis that has `#signing` only when
 * the body names that same key. Returns the DID, the session (scopes
 * `read` and `write`, so the caller can use it straight away) and the AccountView that
 * PUT answered with. `opts.scope` may widen the session but must include `read` and
 * `write` (UsageError `scope_missing`, thrown before anything is sent).
 *
 * PUT answering 503 `unavailable` is retried up to 3 times, honouring Retry-After.
 * Safe to repeat: if the genesis already exists, the DID is reused only when its verified
 * audit log is exactly that genesis (the keys the caller passed, nothing after it). Any
 * later operation (an added key, new rotation keys, aliases) throws
 * UnexpectedDidStateError listing what is there, before signing in: someone who could sign
 * with the wallet before the claim may have planted a key. If PUT answers 409 but GET
 * /api/v2/me already shows this DID, that is success. Every request uses cfg.fetchImpl.
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
  const genesis = buildGenesis({
    walletKey: wallet.didKey,
    ...(signingKey ? { signingKey: signingKey.didKey } : {}),
  });
  const did = deriveDid(genesis);
  const payload = encodeSigningPayload(genesis);
  if (signingKey) await proveKey(signingKey, payload);
  const op: Operation = { ...genesis, sig: await wallet.sign(payload) };
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
    assertBareGenesis(did, log, genesis, wallet.didKey);
  }

  const session = await signIn(cfg, {
    did,
    signer: wallet,
    fragment: "wallet",
    scope,
    dpopKey,
  });
  const accounts = normalizeUrl(cfg.accountsUrl);
  const call = authedFetch(cfg, session);
  const url = `${accounts}/api/v2/me/did`;
  // accounts links a genesis with #signing only when the body names that same key.
  const put: RequestInit = signingKey
    ? {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signingKey: signingKey.didKey }),
      }
    : { method: "PUT" };
  let res = await call(url, put);
  // Directory propagation can lag right after submit: accounts answers 503 `unavailable`
  // ("DID not visible yet; retry") with Retry-After. Retry a few times.
  for (let retry = 0; retry < LINK_RETRIES && res.status === 503; retry++) {
    const err = await AccountsError.fromResponse(res.clone());
    if (err.code !== "unavailable") break;
    await sleep(retryDelayMs(err.retryAfterSeconds));
    res = await call(url, put);
  }
  if (res.ok) {
    return {
      did,
      session,
      account: await accountsJson<AccountView>(res, isAccountView),
    };
  }
  const err = await AccountsError.fromResponse(res);
  // 409: the account may already carry this DID (a retried claim whose response was lost).
  if (res.status === 409) {
    const account = await linkedAccount(cfg, session);
    if (account?.did === did) return { did, session, account };
  }
  throw err;
}

/**
 * The existing DID must be exactly the genesis claimDid built: a verified log of that one
 * operation. Anything after it may have been signed by someone else who could use the
 * wallet before the claim, and is refused (UnexpectedDidStateError) before signing in.
 */
function assertBareGenesis(
  did: string,
  log: readonly AuditEntry[],
  genesis: UnsignedOperation,
  walletKey: string
): void {
  const head = log.at(-1)!.operation;
  if (head.type === "plc_tombstone") throw new DeactivatedError(did);
  if (log.length !== 1 || log[0]!.cid !== computeCid(genesis)) {
    const expected = genesis.verificationMethods;
    const unexpectedKeys = Object.fromEntries(
      Object.entries(head.verificationMethods).filter(([f, key]) => !Object.hasOwn(expected, f) || expected[f] !== key)
    );
    throw new UnexpectedDidStateError(did, { unexpectedKeys, rotationKeys: head.rotationKeys, operations: log.length });
  }
  assertPersonDid(head, walletKey);
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
