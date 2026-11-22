import type { TurnkeyClient } from "@turnkey/http";

import { normalizeUrl, type SdkConfig, send, unboundFetch } from "../config.js";
import { TurnkeyError } from "../errors.js";
import { lookupByWallet } from "./accounts.js";
import { accountsJson } from "./response.js";

export type LoginResult = {
  subOrganizationId: string;
  walletAddress: `0x${string}`;
  did: string | null;
  credentialBundle?: string;
};

/**
 * loginWithEmail's answer (POST /api/v2/login/email, cross-repo contract 2): LoginResult plus
 * two facts about the account, for the app to check before the user relies on it.
 * - `emailVerified`: the account's email was proven. false means the account was created
 *   without proof of the inbox, so whoever logs in now may not be whoever made it.
 * - `otherCredentials`: the account's sub-org holds a passkey or API key that this login
 *   did not create.
 * Open signup lets anyone create an account for an email address with their own passkey and
 * signing key. `emailVerified: false` together with `otherCredentials: true` is that case:
 * someone else may already control the wallet and the DID, so warn the user (or stop) before
 * they link vehicles or receive funds.
 */
export type EmailLoginResult = LoginResult & {
  emailVerified: boolean;
  otherCredentials: boolean;
};

const isAddress = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

const isLoginResult = (b: Record<string, unknown>): boolean =>
  typeof b.subOrganizationId === "string" &&
  isAddress(b.walletAddress) &&
  (b.did === null || typeof b.did === "string") &&
  (b.credentialBundle === undefined || typeof b.credentialBundle === "string");

// Both flags are required: a missing one is invalid_response, never a reassuring default.
const isEmailLoginResult = (b: Record<string, unknown>): boolean =>
  isLoginResult(b) && typeof b.emailVerified === "boolean" && typeof b.otherCredentials === "boolean";

/** Ask accounts to email a one-time code. */
export async function requestEmailCode(cfg: SdkConfig, args: { email: string }): Promise<{ codeId: string }> {
  const res = await send(unboundFetch(cfg), "accounts", `${normalizeUrl(cfg.accountsUrl)}/api/v2/email-codes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: args.email }),
  });
  const { codeId } = await accountsJson<{ codeId: string }>(res, (b) => typeof b.codeId === "string");
  return { codeId };
}

/**
 * Log in (or recover) with the emailed code; returns a Turnkey credential bundle for the
 * session key, and `emailVerified` / `otherCredentials` (see EmailLoginResult). An answer
 * without both booleans is AccountsError `invalid_response`.
 */
export async function loginWithEmail(
  cfg: SdkConfig,
  args: {
    email: string;
    codeId: string;
    code: string;
    sessionPublicKey: string;
  }
): Promise<EmailLoginResult> {
  const res = await send(unboundFetch(cfg), "accounts", `${normalizeUrl(cfg.accountsUrl)}/api/v2/login/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: args.email,
      codeId: args.codeId,
      code: args.code,
      sessionPublicKey: args.sessionPublicKey,
    }),
  });
  return accountsJson<EmailLoginResult>(res, isEmailLoginResult);
}

/**
 * The name prefix of every org's Turnkey sub-org: accounts names them "DIMO org <uuid>"
 * (orgs spec §3). A person's sub-org is "DIMO <email>", and an email has no space.
 */
const ORG_SUB_ORG_PREFIX = "DIMO org ";

/**
 * Passkey login. `turnkey` must be stamped by the passkey. whoami (against the parent org)
 * returns the sub-org; its Ethereum account on m/44'/60'/0'/0/0 is the wallet.
 * A passkey of an org's sub-org (whoami's organizationName starts with "DIMO org ") is
 * TurnkeyError `org_sub_org`, before anything else is read: its org-root wallet sits at the
 * same path, and logging in there would look like an account without a DID (and claimDid
 * would make a person DID rooted in the org's key). Ask the user for their own passkey.
 */
export async function loginWithPasskey(cfg: SdkConfig, args: { turnkey: TurnkeyClient }): Promise<LoginResult> {
  const { turnkey } = args;
  const who = await turnkey.getWhoami({
    organizationId: cfg.turnkeyParentOrgId,
  });
  const subOrganizationId = who.organizationId;
  if (typeof who.organizationName === "string" && who.organizationName.startsWith(ORG_SUB_ORG_PREFIX)) {
    throw new TurnkeyError(
      "org_sub_org",
      `the passkey belongs to an org's sub-organization (${subOrganizationId}), not to a person's account`
    );
  }
  const { accounts } = await turnkey.getWalletAccounts({
    organizationId: subOrganizationId,
  });
  const matches = accounts.filter(
    (a) => a.addressFormat === "ADDRESS_FORMAT_ETHEREUM" && a.path === "m/44'/60'/0'/0/0"
  );
  if (matches.length > 1) {
    throw new TurnkeyError(
      "wallet_ambiguous",
      "multiple Ethereum accounts on m/44'/60'/0'/0/0 in the passkey's sub-organization; cannot pick the wallet"
    );
  }
  const eth = matches[0];
  if (!eth) {
    throw new TurnkeyError(
      "wallet_missing",
      "no Ethereum account on m/44'/60'/0'/0/0 in the passkey's sub-organization"
    );
  }
  const walletAddress = eth.address as `0x${string}`;
  const did = await lookupByWallet(cfg, { address: walletAddress });
  return { subOrganizationId, walletAddress, did };
}
