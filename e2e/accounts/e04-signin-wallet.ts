import { generateDpopKey, getMe } from "../../src/accounts/index.js";
import { check, eq, signInWith, signup, type Scenario } from "./harness.js";

/**
 * E4. Sign-in with key "wallet" (k1 via Turnkey) and a separate P-256 DPoP key.
 * Passes when: a token is issued; GET /api/v2/me returns 200.
 */
export const e04: Scenario = {
  id: "E4",
  title: "sign-in with the wallet key",
  async run(ctx) {
    const user = await signup(ctx, "e04", { device: false });
    const session = await signInWith(
      ctx,
      user.did,
      user.wallet,
      "wallet",
      ["read", "write"],
      await generateDpopKey(),
    );
    check(session.token.length > 0, "no token issued");
    const me = await getMe(ctx.cfg, { session });
    check(me, "GET /me did not return 200 (got 404)");
    eq(me.did, user.did, "GET /me did");
    return "token issued for #wallet, GET /me 200";
  },
};
