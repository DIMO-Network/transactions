import { addDeviceKey, removeDeviceKey, WebCryptoP256Signer } from "../../src/accounts/index.js";
import {
  check,
  eq,
  fragmentsOf,
  login,
  multibaseOf,
  resolveDoc,
  sameSet,
  type Scenario,
  signInWith,
  signup,
} from "./harness.js";

/**
 * E7. Recovery after losing the phone.
 * Passes when: email code, then /login/email, then the session signs in with #wallet,
 * removes the old key and adds a new one; all of it succeeds without the old phone, and
 * rotationKeys is unchanged.
 */
export const e07: Scenario = {
  id: "E7",
  title: "recovery after losing the phone",
  async run(ctx) {
    const original = await signup(ctx, "e07");
    const rotationBefore = (await ctx.directory.head(original.did)).op.rotationKeys;
    const lostPhone = original.device!;
    // From here the old phone and the signup session are never used again.

    const recovered = await login(ctx, "E7", original.email);
    eq(recovered.did, original.did, "login returns the same DID");
    await signInWith(ctx, original.did, recovered.wallet, "wallet", ["write"]);

    await removeDeviceKey(ctx.cfg, {
      did: original.did,
      wallet: recovered.wallet,
      fragment: "signing",
      key: lostPhone.didKey,
    });
    const newPhone = await WebCryptoP256Signer.generate();
    const { fragment } = await addDeviceKey(ctx.cfg, {
      did: original.did,
      wallet: recovered.wallet,
      newKey: newPhone,
    });

    const doc = await resolveDoc(ctx, original.did);
    check(
      !doc.verificationMethod.some((v) => v.publicKeyMultibase === multibaseOf(lostPhone.didKey)),
      "the lost phone's key is still in the document"
    );
    check(fragmentsOf(doc).includes(fragment), "the new phone's key is not in the document");
    sameSet((await ctx.directory.head(original.did)).op.rotationKeys, rotationBefore, "rotationKeys");
    check((await signInWith(ctx, original.did, newPhone, fragment, ["read"])).token, "the new phone cannot sign in");
    return "code -> /login/email -> #wallet sign-in -> old key removed, new key added and signs in, rotationKeys unchanged";
  },
};
