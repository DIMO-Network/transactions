import {
  accountsApi,
  assertEndUserOnlyRoot,
  check,
  eq,
  fragmentsOf,
  newEmail,
  postJson,
  resolveDoc,
  sameSet,
  type Scenario,
  track,
  walletDidKeyOf,
} from "./harness.js";

/**
 * E1. Open creation, wallet only: POST /api/v2/accounts {email}.
 * Passes when: 201; the DID resolves with rotationKeys = [walletKey] and verification
 * methods {wallet}; Turnkey's root quorum is exactly [end user]; emailVerified = false;
 * no email appears anywhere in the DID document or the audit log.
 */
export const e01: Scenario = {
  id: "E1",
  title: "open creation, wallet only",
  async run(ctx) {
    const email = newEmail(ctx, "e01");
    const res = await postJson(ctx, "/accounts", { email });
    if (res.status >= 200 && res.status < 300) track(ctx, "E1", email);
    eq(res.status, 201, `POST ${accountsApi(ctx)}/accounts status`);
    ctx.shared.knownEmail = email;
    const account = (res.body as { account?: Record<string, unknown> }).account;
    check(account, "201 body has no account");
    const did = account.did as string;
    const subOrg = account.subOrganizationId as string;
    const wallet = account.walletAddress as `0x${string}`;

    const doc = await resolveDoc(ctx, did);
    sameSet(fragmentsOf(doc), ["wallet"], "verification methods");
    const log = await ctx.directory.auditLog(did);
    const head = log.at(-1)!.operation;
    const walletKey = await walletDidKeyOf(ctx, subOrg, wallet);
    sameSet(head.rotationKeys, [walletKey], "rotationKeys");
    sameSet(Object.keys(head.verificationMethods), ["wallet"], "head verificationMethods");
    eq(head.verificationMethods.wallet, walletKey, "wallet verification method key");

    await assertEndUserOnlyRoot(ctx, subOrg, email);
    eq(account.emailVerified, false, "emailVerified");

    const haystack = (JSON.stringify(doc) + JSON.stringify(log)).toLowerCase();
    const local = email.split("@")[0]!.toLowerCase();
    check(
      !haystack.includes(email.toLowerCase()) && !haystack.includes(local),
      "the email appears in the DID document or the audit log"
    );
    return `201, ${did}, rotationKeys=[wallet], quorum=[end user], unverified, no email in document or log`;
  },
};
