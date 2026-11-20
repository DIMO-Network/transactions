import { authedFetch } from "../auth/fetch.js";
import { requireScopes } from "../auth/scopes.js";
import type { Session } from "../auth/signin.js";
import { normalizeUrl, type SdkConfig, send, unboundFetch } from "../config.js";
import { decodeDidKey, SIGNUP_POP_MESSAGE, verifyOpSignature } from "../core/index.js";
import { AccountsError, PolicyError, UsageError } from "../errors.js";
import type { Signer } from "../signers/types.js";
import type { PasskeyAttestation, PasskeyTransport } from "./passkeys.js";
import { accountsJson, isObject } from "./response.js";

/** accounts' SupportedChains enum (src/models/enums.ts). */
export type AccountChain = "POLYGON" | "ETHEREUM" | "BASE";

/** accounts' AccountView (src/services/v2/signup.service.ts). */
export interface AccountView {
  did: string;
  email: string;
  emailVerified: boolean;
  subOrganizationId: string;
  walletAddress: string;
  smartAccount: { address: string; chain: AccountChain } | null;
}

/**
 * The attestation POST /accounts accepts. The server's transport list
 * (accounts src/models/v2/validations.ts, TRANSPORTS) is the source of truth for it and
 * today lacks AUTHENTICATOR_TRANSPORT_SMART_CARD, which addPasskey (straight to Turnkey)
 * still takes: sending it here is a 400. Keep this union equal to the server's list.
 */
export type CreateAccountPasskeyAttestation = Omit<PasskeyAttestation, "transports"> & {
  transports: Array<Exclude<PasskeyTransport, "AUTHENTICATOR_TRANSPORT_SMART_CARD">>;
};

export interface CreateAccountInput {
  email: string;
  /** An email code (from requestEmailCode) or a Google/Apple id token. */
  proof?: { codeId: string; code: string } | { idToken: string };
  sessionPublicKey?: string;
  passkey?: {
    challenge: string;
    attestation: CreateAccountPasskeyAttestation;
  };
  /**
   * The device signing key. The SDK signs the signup proof of possession with it and sends
   * `{ didKey, proof }`.
   */
  signingKey?: Signer;
  smartAccount?: { chain: AccountChain; coSigner?: string };
}

export interface CreateAccountResult {
  account: AccountView;
  /** Only for a code proof with a sessionPublicKey. */
  credentialBundle?: string;
}

const accountsBase = (cfg: SdkConfig): string => `${normalizeUrl(cfg.accountsUrl)}/api/v2`;

/** The AccountView fields the SDK relies on. */
export const isAccountView = (v: unknown): boolean =>
  isObject(v) && typeof v.did === "string" && typeof v.email === "string" && typeof v.walletAddress === "string";

/**
 * POST /api/v2/accounts (public, no auth). With a `signingKey` Signer the SDK builds
 * `{ didKey, proof }`: the proof is the Signer's signature over
 * utf8(SIGNUP_POP_MESSAGE(email.trim().toLowerCase(), didKey)), checked locally with
 * verifyOpSignature before anything is sent (PolicyError `proof_invalid`, nothing sent).
 * 409 is AccountsError `conflict` (a signup in progress or with different parameters);
 * other failures are AccountsError with the server's code.
 */
export async function createAccount(cfg: SdkConfig, input: CreateAccountInput): Promise<CreateAccountResult> {
  const { signingKey, ...rest } = input;
  const body: Record<string, unknown> = { ...rest };
  if (signingKey) {
    const message = new TextEncoder().encode(SIGNUP_POP_MESSAGE(input.email.trim().toLowerCase(), signingKey.didKey));
    // Signs, then verifies the signature against the key: a bad Signer throws.
    const proof = await signProof(signingKey, message);
    body.signingKey = { didKey: signingKey.didKey, proof };
  }
  const res = await send(unboundFetch(cfg), "accounts", `${accountsBase(cfg)}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await accountsJson<{
    account: AccountView;
    credentialBundle?: unknown;
  }>(res, (b) => isAccountView(b.account));
  return {
    account: out.account,
    ...(typeof out.credentialBundle === "string" ? { credentialBundle: out.credentialBundle } : {}),
  };
}

/** Sign `message` with `key` and check the signature verifies under its did:key. */
async function signProof(key: Signer, message: Uint8Array): Promise<string> {
  const sig = await key.sign(message);
  if (!verifyOpSignature(message, sig, key.didKey)) {
    throw new PolicyError("proof_invalid", `key ${key.didKey} failed proof of possession`);
  }
  return sig;
}

/**
 * GET /api/v2/me (scope `read`). Returns the account, or null when accounts answers 404
 * `not_found`. Fails before any request when the session lacks `read`.
 */
export async function getMe(cfg: SdkConfig, args: { session: Session }): Promise<AccountView | null> {
  const { session } = args;
  requireScopes(session, ["read"], "reading the account");
  const res = await authedFetch(cfg, session)(`${accountsBase(cfg)}/me`);
  if (!res.ok) {
    const err = await AccountsError.fromResponse(res);
    if (res.status === 404 && err.code === "not_found") return null;
    throw err;
  }
  return accountsJson<AccountView>(res, isAccountView);
}

/**
 * POST /api/v2/me/sign-ins (scope `write`) with `{ deviceKey }`: tell accounts a device
 * key signed in. `deviceKey` must be a did:key. Resolves on 202.
 */
export async function recordSignIn(cfg: SdkConfig, args: { session: Session; deviceKey: string }): Promise<void> {
  const { session, deviceKey } = args;
  requireScopes(session, ["write"], "recording a sign-in");
  decodeDidKey(deviceKey);
  const res = await authedFetch(cfg, session)(`${accountsBase(cfg)}/me/sign-ins`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceKey }),
  });
  if (!res.ok) throw await AccountsError.fromResponse(res);
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * GET /api/v2/accounts/by-wallet/{address} (public). Returns the account's DID, or null
 * when accounts has no account with a DID for this wallet (404). `address` must be 0x plus
 * 40 hex digits (UsageError `address_invalid` otherwise, nothing sent).
 */
export async function lookupByWallet(cfg: SdkConfig, args: { address: string }): Promise<string | null> {
  const { address } = args;
  if (!ADDRESS_RE.test(address)) {
    throw new UsageError("address_invalid", "address must be 0x followed by 40 hex digits");
  }
  const res = await send(unboundFetch(cfg), "accounts", `${accountsBase(cfg)}/accounts/by-wallet/${address}`);
  if (!res.ok) {
    const err = await AccountsError.fromResponse(res);
    if (res.status === 404 && err.code === "not_found") return null;
    throw err;
  }
  const { did } = await accountsJson<{ did: string }>(res, (b) => typeof b.did === "string");
  return did;
}
