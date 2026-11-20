/** Shared plumbing for the scenarios: context, assertions, mailbox, Turnkey, sessions, cleanup. */
import { randomBytes } from "node:crypto";
import { bytesToHex } from "@noble/hashes/utils.js";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import {
  decryptCredentialBundle,
  generateP256KeyPair,
  getPublicKey,
} from "@turnkey/crypto";
import { TurnkeyClient } from "@turnkey/http";
import {
  DirectoryClient,
  DirectoryRejectedError,
  TurnkeyWalletSigner,
  WebCryptoP256Signer,
  createAccount,
  deleteAccount,
  generateDpopKey,
  loginWithEmail,
  normalizeUrl,
  requestEmailCode,
  signIn,
  turnkeyWalletDidKey,
  type CreateAccountInput,
  type DidDocument,
  type DpopKey,
  type SdkConfig,
  type Session,
  type Scope,
  type Signer,
} from "../src/index.js";
import type { E2eEnv } from "./env.js";

export const CHAIN_ID = 80002;

/** An assertion failed: the scenario prints FAIL with this message. */
export class Failure extends Error {}
/** The scenario cannot run for a stated reason: it prints SKIP. */
export class Skip extends Error {}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Failure(msg);
}

export function eq<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new Failure(
      `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function sameSet(
  actual: readonly string[],
  expected: readonly string[],
  what: string,
): void {
  const a = JSON.stringify([...actual].sort());
  const e = JSON.stringify([...expected].sort());
  if (a !== e) throw new Failure(`${what}: expected ${e}, got ${a}`);
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface Ctx {
  env: E2eEnv;
  /** Every SDK call goes through cfg.fetchImpl, which counts requests to ACCOUNTS_URL. */
  cfg: SdkConfig;
  directory: DirectoryClient;
  parentTurnkey: TurnkeyClient;
  accountsRequests: number;
  /** DirectoryRejectedError instances seen, plus directory 400s that name a mismatch or a signature (E14). */
  directoryRejections: string[];
  /** Emails to log in to and delete at the end. */
  cleanup: { scenario: string; email: string }[];
  lastCodeAt: Map<string, number>;
  shared: { knownEmail?: string; e15Unknown?: number };
  partnerSession?: Session;
}

export function makeCtx(env: E2eEnv): Ctx {
  const accountsPrefix = normalizeUrl(env.ACCOUNTS_URL);
  const directoryPrefix = normalizeUrl(env.DIRECTORY_URL);
  const ctx: Ctx = {
    env,
    cfg: undefined as unknown as SdkConfig,
    directory: undefined as unknown as DirectoryClient,
    parentTurnkey: new TurnkeyClient(
      { baseUrl: env.TURNKEY_BASE_URL },
      new ApiKeyStamper({
        apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
        apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
      }),
    ),
    accountsRequests: 0,
    directoryRejections: [],
    cleanup: [],
    lastCodeAt: new Map(),
    shared: {},
  };
  const countingFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(accountsPrefix)) ctx.accountsRequests++;
    const res = await globalThis.fetch(input, init);
    if (url.startsWith(directoryPrefix) && res.status === 400) {
      const text = await res.clone().text();
      if (/mismatch|signature/i.test(text)) {
        ctx.directoryRejections.push(`directory 400: ${text.slice(0, 120)}`);
      }
    }
    return res;
  };
  ctx.cfg = {
    accountsUrl: env.ACCOUNTS_URL,
    dauthUrl: env.DAUTH_URL,
    directoryUrl: env.DIRECTORY_URL,
    turnkeyParentOrgId: env.TURNKEY_PARENT_ORG_ID,
    rpcUrls: { [CHAIN_ID]: env.RPC_URL_80002 },
    fetchImpl: countingFetch,
  };
  ctx.directory = new DirectoryClient(env.DIRECTORY_URL, countingFetch);
  return ctx;
}

/** Record DirectoryRejectedErrors found anywhere in an error's cause chain (E14). */
export function noteError(ctx: Ctx, e: unknown): void {
  for (let cur = e, i = 0; cur instanceof Error && i < 10; i++) {
    if (cur instanceof DirectoryRejectedError) {
      ctx.directoryRejections.push(
        `DirectoryRejectedError ${cur.status}: ${cur.message}`,
      );
    }
    cur = cur.cause;
  }
}

export interface Scenario {
  id: string;
  title: string;
  /** Resolve with a short reason on PASS; throw Failure to FAIL or Skip to SKIP. */
  run(ctx: Ctx): Promise<string>;
}

export const accountsApi = (ctx: Ctx): string =>
  `${normalizeUrl(ctx.env.ACCOUNTS_URL)}/api/v2`;

export function newEmail(ctx: Ctx, scenario: string): string {
  return `e2e+${scenario}-${Date.now()}-${randomBytes(3).toString("hex")}@${ctx.env.E2E_EMAIL_DOMAIN}`;
}

/** Remember an account to delete at the end. */
export function track(ctx: Ctx, scenario: string, email: string): void {
  ctx.cleanup.push({ scenario, email });
}

/** A plain accounts call outside the SDK (for status codes the SDK hides). */
export async function accountsRaw(
  ctx: Ctx,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await globalThis.fetch(`${accountsApi(ctx)}${path}`, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

export const postJson = (ctx: Ctx, path: string, body: unknown) =>
  accountsRaw(ctx, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const errorCode = (body: unknown): string | undefined => {
  const e = (body as { error?: { code?: unknown } } | undefined)?.error;
  return typeof e?.code === "string" ? e.code : undefined;
};

// --- mailbox ---------------------------------------------------------------

async function peekCode(ctx: Ctx, email: string): Promise<string | null> {
  const res = await globalThis.fetch(
    `${ctx.env.MAILBOX_API}/latest?to=${encodeURIComponent(email)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Failure(`mailbox answered HTTP ${res.status}`);
  const body = (await res.json()) as { code?: unknown };
  return typeof body.code === "string" && body.code ? body.code : null;
}

const MIN_CODE_GAP_MS = 31_000;

/**
 * Request an email code and read it from the mailbox. accounts sends at most one code per
 * email per 30 s, so this waits out the gap first and retries once if nothing arrives.
 */
export async function requestCode(
  ctx: Ctx,
  email: string,
): Promise<{ codeId: string; code: string }> {
  for (let attempt = 1; ; attempt++) {
    const gap = Date.now() - (ctx.lastCodeAt.get(email) ?? 0);
    if (gap < MIN_CODE_GAP_MS) await sleep(MIN_CODE_GAP_MS - gap);
    const before = await peekCode(ctx, email);
    const { codeId } = await requestEmailCode(ctx.cfg, { email });
    ctx.lastCodeAt.set(email, Date.now());
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      await sleep(1000);
      const now = await peekCode(ctx, email);
      if (now !== null && now !== before) return { codeId, code: now };
    }
    if (attempt >= 2) {
      throw new Failure(
        `no new email code for ${email} arrived in the mailbox`,
      );
    }
  }
}

// --- Turnkey ---------------------------------------------------------------

export type SessionKey = ReturnType<typeof generateP256KeyPair>;
export const newSessionKey = (): SessionKey => generateP256KeyPair();

/** A Turnkey client stamping as the end user, from the credential bundle of a signup or login. */
export function userTurnkey(
  ctx: Ctx,
  bundle: string,
  sessionKey: SessionKey,
): TurnkeyClient {
  const priv = decryptCredentialBundle(bundle, sessionKey.privateKey);
  const pub = bytesToHex(getPublicKey(priv, true));
  return new TurnkeyClient(
    { baseUrl: ctx.env.TURNKEY_BASE_URL },
    new ApiKeyStamper({ apiPublicKey: pub, apiPrivateKey: priv }),
  );
}

export async function walletSigner(
  ctx: Ctx,
  turnkey: TurnkeyClient,
  subOrganizationId: string,
  walletAddress: `0x${string}`,
): Promise<TurnkeyWalletSigner> {
  return new TurnkeyWalletSigner({
    client: turnkey,
    organizationId: subOrganizationId,
    walletAddress,
    didKey: await turnkeyWalletDidKey(
      turnkey,
      subOrganizationId,
      walletAddress,
    ),
    mode: ctx.env.signMode,
  });
}

/** The wallet's did:key, read with the parent-org API key (read-only). */
export const walletDidKeyOf = (
  ctx: Ctx,
  subOrganizationId: string,
  walletAddress: `0x${string}`,
): Promise<string> =>
  turnkeyWalletDidKey(ctx.parentTurnkey, subOrganizationId, walletAddress);

export async function rootQuorum(ctx: Ctx, subOrganizationId: string) {
  const { organizationData } = await ctx.parentTurnkey.getOrganization({
    organizationId: subOrganizationId,
  });
  const users = organizationData.users ?? [];
  const quorum = organizationData.rootQuorum;
  return {
    threshold: quorum?.threshold ?? 0,
    userIds: quorum?.userIds ?? [],
    users,
  };
}

const isEndUser = (
  u: { userName?: string; userEmail?: string } | undefined,
  email: string,
): boolean =>
  !!u &&
  (u.userName?.toLowerCase() === email.toLowerCase() ||
    u.userEmail?.toLowerCase() === email.toLowerCase());

/** The sub-org's root quorum is exactly [end user]. */
export async function assertEndUserOnlyRoot(
  ctx: Ctx,
  subOrganizationId: string,
  email: string,
): Promise<void> {
  const q = await rootQuorum(ctx, subOrganizationId);
  eq(q.userIds.length, 1, "root quorum size");
  eq(q.threshold, 1, "root quorum threshold");
  const sole = q.users.find((u) => u.userId === q.userIds[0]);
  check(isEndUser(sole, email), "the sole root user is the end user, not DIMO");
}

/** The end user is among the sub-org's root users (v1 account created with deployAccount). */
export async function assertEndUserIsRoot(
  ctx: Ctx,
  subOrganizationId: string,
  email: string,
): Promise<void> {
  const q = await rootQuorum(ctx, subOrganizationId);
  const roots = q.users.filter((u) => q.userIds.includes(u.userId));
  check(
    roots.some((u) => isEndUser(u, email)),
    "setup: after deployAccount: true the user is not in the root quorum",
  );
}

/** The sub-org's root quorum is exactly [DIMO] (a v1 account whose end user is not root). */
export async function assertDimoOnlyRoot(
  ctx: Ctx,
  subOrganizationId: string,
  email: string,
): Promise<void> {
  const q = await rootQuorum(ctx, subOrganizationId);
  eq(q.userIds.length, 1, "root quorum size");
  const sole = q.users.find((u) => u.userId === q.userIds[0]);
  check(sole && !isEndUser(sole, email), "the sole root user is DIMO");
}

// --- DIDs ------------------------------------------------------------------

export const fragmentsOf = (doc: DidDocument): string[] =>
  doc.verificationMethod.map((v) => v.id.slice(v.id.lastIndexOf("#") + 1));

export async function resolveDoc(ctx: Ctx, did: string): Promise<DidDocument> {
  const doc = await ctx.directory.resolve(did);
  check(doc, `the directory does not resolve ${did}`);
  return doc;
}

export const multibaseOf = (didKey: string): string =>
  didKey.slice("did:key:".length);

export function jwtClaims(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  check(part, "token is not a JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

// --- accounts --------------------------------------------------------------

export interface User {
  email: string;
  did: string;
  subOrganizationId: string;
  walletAddress: `0x${string}`;
  turnkey: TurnkeyClient;
  wallet: TurnkeyWalletSigner;
  device?: WebCryptoP256Signer;
}

/**
 * Sign up with an email code, a session key and (by default) a fresh P-256 device key,
 * through createAccount. The account is queued for deletion.
 */
export async function signup(
  ctx: Ctx,
  scenario: string,
  opts: {
    device?: boolean;
    smartAccount?: CreateAccountInput["smartAccount"];
  } = {},
): Promise<User> {
  const email = newEmail(ctx, scenario);
  const { codeId, code } = await requestCode(ctx, email);
  const device =
    opts.device === false ? undefined : await WebCryptoP256Signer.generate();
  const sessionKey = newSessionKey();
  const { account, credentialBundle } = await createAccount(ctx.cfg, {
    email,
    proof: { codeId, code },
    sessionPublicKey: sessionKey.publicKeyUncompressed,
    ...(device ? { signingKey: device } : {}),
    ...(opts.smartAccount ? { smartAccount: opts.smartAccount } : {}),
  });
  track(ctx, scenario, email);
  check(
    credentialBundle,
    "signup with a code and a session key returned no credentialBundle",
  );
  const walletAddress = account.walletAddress as `0x${string}`;
  const turnkey = userTurnkey(ctx, credentialBundle, sessionKey);
  return {
    email,
    did: account.did,
    subOrganizationId: account.subOrganizationId,
    walletAddress,
    turnkey,
    wallet: await walletSigner(
      ctx,
      turnkey,
      account.subOrganizationId,
      walletAddress,
    ),
    ...(device ? { device } : {}),
  };
}

/** Log in with an email code ("/login/email"): a user session for an existing account. */
export async function login(
  ctx: Ctx,
  scenario: string,
  email: string,
): Promise<Omit<User, "did"> & { did: string | null }> {
  const { codeId, code } = await requestCode(ctx, email);
  const sessionKey = newSessionKey();
  const res = await loginWithEmail(ctx.cfg, {
    email,
    codeId,
    code,
    sessionPublicKey: sessionKey.publicKeyUncompressed,
  });
  check(
    res.credentialBundle,
    `${scenario}: login returned no credentialBundle`,
  );
  const turnkey = userTurnkey(ctx, res.credentialBundle, sessionKey);
  return {
    email,
    did: res.did,
    subOrganizationId: res.subOrganizationId,
    walletAddress: res.walletAddress,
    turnkey,
    wallet: await walletSigner(
      ctx,
      turnkey,
      res.subOrganizationId,
      res.walletAddress,
    ),
  };
}

export async function signInWith(
  ctx: Ctx,
  did: string,
  signer: Signer,
  fragment: string,
  scope: Scope[],
  dpopKey?: DpopKey,
): Promise<Session> {
  return signIn(ctx.cfg, {
    did,
    signer,
    fragment,
    scope,
    dpopKey: dpopKey ?? (await generateDpopKey()),
  });
}

/** Delete the account the way a user does: DELETE /me, the sub-org, then the tombstone. */
export async function deleteUser(
  ctx: Ctx,
  user: Pick<User, "did" | "wallet" | "turnkey" | "subOrganizationId">,
): Promise<void> {
  const session = await signInWith(ctx, user.did, user.wallet, "wallet", [
    "approve",
  ]);
  await deleteAccount(ctx.cfg, {
    session,
    wallet: user.wallet,
    turnkeyWithUserStamper: user.turnkey,
    subOrganizationId: user.subOrganizationId,
    deleteWithoutExport: true,
  });
}

export interface CleanupResult {
  deleted: number;
  failed: string[];
  leftBehind: number;
}

const BULK_WAIT_MS = 65_000;
const MAX_429_RETRIES = 4;

/** Delete everything the scenarios created. */
export async function cleanupAll(ctx: Ctx): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, failed: [], leftBehind: 0 };
  const bulk = (s: string) => s === "E18";
  const work = ctx.cleanup.filter(
    (c) => ctx.env.bulkCleanup || !bulk(c.scenario),
  );
  result.leftBehind = ctx.cleanup.length - work.length;
  const hasBulk = work.some((c) => bulk(c.scenario));
  // Bulk signups used the public per-IP limit: let its window pass before the logins start.
  if (hasBulk) await sleep(BULK_WAIT_MS);
  const one = async (item: { scenario: string; email: string }) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const user = await login(ctx, item.scenario, item.email);
        if (!user.did) {
          result.failed.push(
            `${item.scenario} ${item.email}: no DID, cannot delete`,
          );
          return;
        }
        await deleteUser(ctx, { ...user, did: user.did });
        result.deleted++;
        return;
      } catch (e) {
        const limited = (e as { status?: unknown }).status === 429;
        if (limited && attempt < MAX_429_RETRIES) {
          await sleep(BULK_WAIT_MS);
          continue;
        }
        result.failed.push(
          `${item.scenario} ${item.email}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    }
  };
  const next = async (): Promise<void> => {
    for (let item = work.shift(); item; item = work.shift()) await one(item);
  };
  const workers = hasBulk
    ? Math.min(work.length, ctx.env.cleanupConcurrency)
    : 1;
  await Promise.all(Array.from({ length: Math.max(workers, 1) }, next));
  return result;
}
