import { addDeviceKey, WebCryptoP256Signer } from "../../src/accounts/index.js";
import { check, eq, multibaseOf, resolveDoc, sameSet, type Scenario, signInWith, signup } from "./harness.js";

/**
 * E5. Add a device through the SDK.
 * Passes when: the new key is in the resolved document and can sign in; rotationKeys is
 * unchanged; the SDK's wrapped fetch records zero requests to accountsUrl during the change.
 */
export const e05: Scenario = {
  id: "E5",
  title: "add a device",
  async run(ctx) {
    const user = await signup(ctx, "e05");
    check(ctx.accountsRequests > 0, "control: the accounts request counter did not move during signup");
    const before = (await ctx.directory.head(user.did)).op.rotationKeys;
    const newKey = await WebCryptoP256Signer.generate();

    const requestsBefore = ctx.accountsRequests;
    const { fragment } = await addDeviceKey(ctx.cfg, {
      did: user.did,
      wallet: user.wallet,
      newKey,
    });
    const toAccounts = ctx.accountsRequests - requestsBefore;
    eq(toAccounts, 0, "requests to accountsUrl during addDeviceKey");

    const doc = await resolveDoc(ctx, user.did);
    const vm = doc.verificationMethod.find((v) => v.id.endsWith(`#${fragment}`));
    check(vm, `the new key's fragment #${fragment} is not in the resolved document`);
    eq(vm.publicKeyMultibase, multibaseOf(newKey.didKey), "new key in the document");
    sameSet((await ctx.directory.head(user.did)).op.rotationKeys, before, "rotationKeys");

    const session = await signInWith(ctx, user.did, newKey, fragment, ["read"]);
    check(session.token, "the new key cannot sign in");
    return `#${fragment} in the document, signs in, rotationKeys unchanged, 0 accounts requests`;
  },
};
