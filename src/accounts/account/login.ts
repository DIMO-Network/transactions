import type { TurnkeyClient } from "@turnkey/http";
import { TurnkeyError } from "../errors.js";
import { normalizeUrl, send, unboundFetch, type SdkConfig } from "../config.js";
import { lookupByWallet } from "./accounts.js";
import { accountsJson } from "./response.js";

export type LoginResult = {
  subOrganizationId: string;
  walletAddress: `0x${string}`;
  did: string | null;
  credentialBundle?: string;
};

const isAddress = (v: unknown): v is `0x${string}` =>
  typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

const isLoginResult = (b: Record<string, unknown>): boolean =>
  typeof b.subOrganizationId === "string" &&
  isAddress(b.walletAddress) &&
  (b.did === null || typeof b.did === "string") &&
  (b.credentialBundle === undefined || typeof b.credentialBundle === "string");

/** Ask accounts to email a one-time code. */
export async function requestEmailCode(
  cfg: SdkConfig,
  args: { email: string },
): Promise<{ codeId: string }> {
  const res = await send(
    unboundFetch(cfg),
    "accounts",
    `${normalizeUrl(cfg.accountsUrl)}/api/v2/email-codes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: args.email }),
    },
  );
  const { codeId } = await accountsJson<{ codeId: string }>(
    res,
    (b) => typeof b.codeId === "string",
  );
  return { codeId };
}

/** Log in (or recover) with the emailed code; returns a Turnkey credential bundle for the session key. */
export async function loginWithEmail(
  cfg: SdkConfig,
  args: {
    email: string;
    codeId: string;
    code: string;
    sessionPublicKey: string;
  },
): Promise<LoginResult> {
  const res = await send(
    unboundFetch(cfg),
    "accounts",
    `${normalizeUrl(cfg.accountsUrl)}/api/v2/login/email`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: args.email,
        codeId: args.codeId,
        code: args.code,
        sessionPublicKey: args.sessionPublicKey,
      }),
    },
  );
  return accountsJson<LoginResult>(res, isLoginResult);
}

/**
 * Passkey login. `turnkey` must be stamped by the passkey. whoami (against the parent org)
 * returns the sub-org; its Ethereum account on m/44'/60'/0'/0/0 is the wallet.
 */
export async function loginWithPasskey(
  cfg: SdkConfig,
  args: { turnkey: TurnkeyClient },
): Promise<LoginResult> {
  const { turnkey } = args;
  const who = await turnkey.getWhoami({
    organizationId: cfg.turnkeyParentOrgId,
  });
  const subOrganizationId = who.organizationId;
  const { accounts } = await turnkey.getWalletAccounts({
    organizationId: subOrganizationId,
  });
  const matches = accounts.filter(
    (a) =>
      a.addressFormat === "ADDRESS_FORMAT_ETHEREUM" &&
      a.path === "m/44'/60'/0'/0/0",
  );
  if (matches.length > 1) {
    throw new TurnkeyError(
      "wallet_ambiguous",
      "multiple Ethereum accounts on m/44'/60'/0'/0/0 in the passkey's sub-organization; cannot pick the wallet",
    );
  }
  const eth = matches[0];
  if (!eth) {
    throw new TurnkeyError(
      "wallet_missing",
      "no Ethereum account on m/44'/60'/0'/0/0 in the passkey's sub-organization",
    );
  }
  const walletAddress = eth.address as `0x${string}`;
  const did = await lookupByWallet(cfg, { address: walletAddress });
  return { subOrganizationId, walletAddress, did };
}
