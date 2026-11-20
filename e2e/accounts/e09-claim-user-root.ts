import {
  AccountsError,
  WebCryptoP256Signer,
  claimDid,
  generateDpopKey,
  getMe,
  lookupByWallet,
} from "../src/index.js";
import {
  Failure,
  assertEndUserIsRoot,
  check,
  eq,
  login,
  newEmail,
  track,
  type Scenario,
} from "./harness.js";
import { strangerWallet } from "./k1.js";
import { v1Create } from "./v1.js";

async function expectAccountsError(
  what: string,
  status: number,
  code: string,
  p: Promise<unknown>,
): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AccountsError) {
      eq(e.status, status, `${what}: status (${e.code})`);
      eq(e.code, code, `${what}: error code`);
      return;
    }
    throw e;
  }
  throw new Failure(`${what}: expected ${status}, but it succeeded`);
}

/**
 * E9. v1 claim where the user is root. Setup: v1 create with deployAccount: true, then a
 * user session from /login/email.
 * Passes when: SDK claimDid, then PUT /me/did, links the DID; a second PUT returns 409; a
 * DID whose rotation key isn't this user's wallet returns 403.
 *
 * "A second PUT" is a PUT for another DID of the same wallet: accounts answers a repeat of
 * the very same DID with an idempotent 200, and 409 only when the account already holds a
 * different DID.
 */
export const e09: Scenario = {
  id: "E9",
  title: "v1 claim, user is root",
  async run(ctx) {
    const email = newEmail(ctx, "e09");
    await v1Create(ctx, { email, deployAccount: true });
    track(ctx, "E9", email);
    const user = await login(ctx, "E9", email);
    await assertEndUserIsRoot(ctx, user.subOrganizationId, email);

    // 403: a DID rooted in a real secp256k1 wallet key that owns no account.
    const stranger = strangerWallet();
    await expectAccountsError(
      "PUT /me/did for a DID not rooted in the user's wallet",
      403,
      "forbidden",
      claimDid(ctx.cfg, { wallet: stranger, dpopKey: await generateDpopKey() }),
    );

    const first = await claimDid(ctx.cfg, {
      wallet: user.wallet,
      dpopKey: await generateDpopKey(),
    });
    eq(first.account.did, first.did, "claimDid account did");
    eq(
      first.account.walletAddress.toLowerCase(),
      user.walletAddress.toLowerCase(),
      "claimDid account wallet",
    );
    const me = await getMe(ctx.cfg, { session: first.session });
    check(me, "GET /me returned 404 after claimDid");
    eq(me.did, first.did, "GET /me did after claimDid");
    eq(
      await lookupByWallet(ctx.cfg, { address: user.walletAddress }),
      first.did,
      "by-wallet lookup after claimDid",
    );

    // 409: another DID for the same wallet (a different signing key gives a different genesis).
    await expectAccountsError(
      "second PUT /me/did with a different DID",
      409,
      "conflict",
      claimDid(ctx.cfg, {
        wallet: user.wallet,
        signingKey: await WebCryptoP256Signer.generate(),
        dpopKey: await generateDpopKey(),
      }),
    );
    return `linked ${first.did}; a second DID got 409; a DID of an unowned wallet got 403 forbidden`;
  },
};
