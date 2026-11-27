import {
  AccountsError,
  claimDid,
  generateDpopKey,
  getMe,
  lookupByWallet,
  WebCryptoP256Signer,
} from "../../src/accounts/index.js";
import { assertEndUserIsRoot, check, eq, Failure, login, newEmail, type Scenario, track } from "./harness.js";
import { strangerWallet } from "./k1.js";
import { v1Create } from "./v1.js";

async function expectAccountsError(what: string, status: number, code: string, p: Promise<unknown>): Promise<void> {
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
 * Passes when: SDK claimDid, then PUT /me/did, links the DID; claimDid again with a
 * signing key links the same DID again (an idempotent 200) and then adds #signing with a
 * wallet-signed update; a DID whose rotation key isn't this user's wallet returns 403.
 *
 * A person's genesis is wallet-only, so a wallet has exactly one claimable DID: the old
 * "second DID for the same wallet gets 409" step can no longer happen through claimDid.
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
      claimDid(ctx.cfg, { wallet: stranger, dpopKey: await generateDpopKey() })
    );

    const first = await claimDid(ctx.cfg, {
      wallet: user.wallet,
      dpopKey: await generateDpopKey(),
    });
    eq(first.account.did, first.did, "claimDid account did");
    eq(first.account.walletAddress.toLowerCase(), user.walletAddress.toLowerCase(), "claimDid account wallet");
    const me = await getMe(ctx.cfg, { session: first.session });
    check(me, "GET /me returned 404 after claimDid");
    eq(me.did, first.did, "GET /me did after claimDid");
    eq(await lookupByWallet(ctx.cfg, { address: user.walletAddress }), first.did, "by-wallet lookup after claimDid");

    // Again with a signing key: the same wallet-only DID (an idempotent link), then #signing
    // added by a wallet-signed update after the link.
    const signingKey = await WebCryptoP256Signer.generate();
    const second = await claimDid(ctx.cfg, {
      wallet: user.wallet,
      signingKey,
      dpopKey: await generateDpopKey(),
    });
    eq(second.did, first.did, "claimDid with a signing key: same DID");
    const head = await ctx.directory.head(first.did);
    eq(head.op.verificationMethods.signing, signingKey.didKey, "#signing after the second claimDid");
    return `linked ${first.did}; claimDid again added #signing after the link; a DID of an unowned wallet got 403 forbidden`;
  },
};
