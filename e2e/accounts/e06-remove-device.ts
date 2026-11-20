import {
  SigninError,
  WebCryptoP256Signer,
  addDeviceKey,
  removeDeviceKey,
} from "../../src/accounts/index.js";
import {
  Failure,
  check,
  eq,
  signInWith,
  signup,
  type Scenario,
} from "./harness.js";

/**
 * E6. Remove a device.
 * Passes when: the very next sign-in with the removed key returns 401 invalid_grant (no cache).
 */
export const e06: Scenario = {
  id: "E6",
  title: "remove a device",
  async run(ctx) {
    const user = await signup(ctx, "e06");
    const second = await WebCryptoP256Signer.generate();
    const { fragment } = await addDeviceKey(ctx.cfg, {
      did: user.did,
      wallet: user.wallet,
      newKey: second,
    });
    // Control: the key signs in before it is removed.
    check(
      (await signInWith(ctx, user.did, second, fragment, ["read"])).token,
      "the added key cannot sign in before removal",
    );
    await removeDeviceKey(ctx.cfg, {
      did: user.did,
      wallet: user.wallet,
      fragment,
      key: second.didKey,
    });
    try {
      await signInWith(ctx, user.did, second, fragment, ["read"]);
    } catch (e) {
      if (e instanceof SigninError) {
        eq(e.status, 401, "sign-in status after removal");
        eq(e.code, "invalid_grant", "sign-in error code after removal");
        return "the next sign-in with the removed key got 401 invalid_grant";
      }
      throw e;
    }
    throw new Failure("a removed key still signed in");
  },
};
