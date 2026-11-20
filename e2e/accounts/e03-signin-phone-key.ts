import { generateDpopKey, getMe, recordSignIn } from "../src/index.js";
import {
  check,
  eq,
  jwtClaims,
  signInWith,
  signup,
  type Scenario,
} from "./harness.js";

/**
 * E3. Sign-in with the r1 phone key.
 * Passes when: the token has sub = DID and cnf.jkt equal to the DPoP key's thumbprint;
 * GET /api/v2/me returns 200; recordSignIn with the session's device key resolves (202).
 */
export const e03: Scenario = {
  id: "E3",
  title: "sign-in with the phone key",
  async run(ctx) {
    const user = await signup(ctx, "e03");
    const dpop = await generateDpopKey();
    const session = await signInWith(
      ctx,
      user.did,
      user.device!,
      "signing",
      ["read", "write"],
      dpop,
    );
    const claims = jwtClaims(session.token);
    eq(claims.sub, user.did, "token sub");
    eq(
      (claims.cnf as { jkt?: string } | undefined)?.jkt,
      await dpop.thumbprint(),
      "token cnf.jkt",
    );
    const me = await getMe(ctx.cfg, { session });
    check(me, "GET /me did not return 200 (got 404)");
    eq(me.did, user.did, "GET /me did");
    // POST /me/sign-ins answers 202; recordSignIn resolves only on a 2xx.
    await recordSignIn(ctx.cfg, { session, deviceKey: user.device!.didKey });
    return "sub=DID, cnf.jkt=DPoP thumbprint, GET /me 200, POST /me/sign-ins 202";
  },
};
