import { authedFetch, lookupByWallet, normalizeUrl } from "../src/index.js";
import {
  accountsRaw,
  deleteUser,
  eq,
  signup,
  type Ctx,
  type Scenario,
} from "./harness.js";
import { partnerSession } from "./partner.js";

const partnerLookup = async (ctx: Ctx, email: string): Promise<number> => {
  const session = await partnerSession(ctx);
  const res = await authedFetch(
    ctx.cfg,
    session,
  )(
    `${normalizeUrl(ctx.env.ACCOUNTS_URL)}/api/v2/partner/accounts?email=${encodeURIComponent(email)}`,
  );
  await res.text();
  return res.status;
};

/**
 * E11. Delete.
 * Passes when: after DELETE /me, then deleting the sub-org, then the tombstone, the
 * directory answers 410, GET /accounts/by-wallet/{address} returns 404, and a partner
 * GET /partner/accounts?email= returns 404.
 */
export const e11: Scenario = {
  id: "E11",
  title: "delete",
  async run(ctx) {
    const user = await signup(ctx, "e11");
    // Controls: before the delete the account is visible, so a later 404 means "deleted".
    eq(
      await partnerLookup(ctx, user.email),
      200,
      "partner lookup before delete",
    );
    eq(
      await lookupByWallet(ctx.cfg, { address: user.walletAddress }),
      user.did,
      "by-wallet lookup before delete",
    );
    await deleteUser(ctx, user);
    ctx.cleanup.pop(); // deleted here, so not again at the end

    const dir = await globalThis.fetch(
      `${normalizeUrl(ctx.env.DIRECTORY_URL)}/${user.did}`,
    );
    await dir.text();
    eq(dir.status, 410, "directory answer for the deleted DID");
    const byWallet = await accountsRaw(
      ctx,
      `/accounts/by-wallet/${user.walletAddress}`,
    );
    eq(byWallet.status, 404, "GET /accounts/by-wallet/{address}");
    eq(
      await partnerLookup(ctx, user.email),
      404,
      "partner GET /partner/accounts?email=",
    );
    return "directory 410, by-wallet 404, partner lookup 404";
  },
};
