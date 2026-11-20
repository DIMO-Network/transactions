import { WebCryptoP256Signer } from "../../src/accounts/index.js";
import { createAccount } from "../../src/accounts/index.js";
import {
  check,
  eq,
  fragmentsOf,
  multibaseOf,
  newEmail,
  newSessionKey,
  requestCode,
  resolveDoc,
  sameSet,
  type Scenario,
  track,
  userTurnkey,
  walletDidKeyOf,
} from "./harness.js";

/**
 * E2. Creation for a new email with an email code and an r1 phone key.
 * Passes when: verification methods are {wallet, signing}, signing decodes as p256, and
 * rotationKeys = [walletKey]; emailVerified = true; the returned credentialBundle stamps
 * a Turnkey whoami.
 */
export const e02: Scenario = {
  id: "E2",
  title: "creation with an email code and a phone key",
  async run(ctx) {
    const email = newEmail(ctx, "e02");
    const { codeId, code } = await requestCode(ctx, email);
    const device = await WebCryptoP256Signer.generate();
    const sessionKey = newSessionKey();
    const { account, credentialBundle } = await createAccount(ctx.cfg, {
      email,
      proof: { codeId, code },
      sessionPublicKey: sessionKey.publicKeyUncompressed,
      signingKey: device,
    });
    track(ctx, "E2", email);

    const doc = await resolveDoc(ctx, account.did);
    sameSet(fragmentsOf(doc), ["wallet", "signing"], "verification methods");
    const signing = doc.verificationMethod.find((v) => v.id.endsWith("#signing"));
    check(signing, "no signing verification method");
    check(
      signing.publicKeyMultibase.startsWith("zDn"),
      `signing key is not p256 (multibase ${signing.publicKeyMultibase.slice(0, 6)}...)`
    );
    eq(signing.publicKeyMultibase, multibaseOf(device.didKey), "signing key is the phone key");
    const head = (await ctx.directory.head(account.did)).op;
    const walletKey = await walletDidKeyOf(ctx, account.subOrganizationId, account.walletAddress as `0x${string}`);
    sameSet(head.rotationKeys, [walletKey], "rotationKeys");
    eq(account.emailVerified, true, "emailVerified");

    check(credentialBundle, "no credentialBundle returned");
    const who = await userTurnkey(ctx, credentialBundle, sessionKey).getWhoami({
      organizationId: ctx.env.TURNKEY_PARENT_ORG_ID,
    });
    eq(who.organizationId, account.subOrganizationId, "whoami organization");
    return "methods {wallet, signing(p256)}, rotationKeys=[wallet], verified, bundle stamps whoami";
  },
};
