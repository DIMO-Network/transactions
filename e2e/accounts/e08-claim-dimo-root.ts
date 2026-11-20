import { AccountsError, createAccount } from "../src/index.js";
import {
  Failure,
  assertDimoOnlyRoot,
  assertEndUserOnlyRoot,
  check,
  eq,
  errorCode,
  newEmail,
  newSessionKey,
  postJson,
  requestCode,
  track,
  type Scenario,
} from "./harness.js";
import { softwareAttestation, v1Create } from "./v1.js";

/**
 * E8. v1 claim where DIMO is the only root. Setup: v1 POST /api/account with a software
 * passkey, no deploy.
 * Passes when: POST /accounts with a code returns a DID; the quorum afterwards is
 * [end user]. Without a code it returns 401 proof_required.
 */
export const e08: Scenario = {
  id: "E8",
  title: "v1 claim, DIMO the only root",
  async run(ctx) {
    const email = newEmail(ctx, "e08");
    const { subOrganizationId } = await v1Create(ctx, {
      email,
      deployAccount: false,
      ...softwareAttestation(ctx),
    });
    track(ctx, "E8", email);
    await assertDimoOnlyRoot(ctx, subOrganizationId, email).catch(
      (e: unknown) => {
        throw new Failure(
          `setup: ${e instanceof Error ? e.message : String(e)}`,
        );
      },
    );

    const noProof = await postJson(ctx, "/accounts", { email });
    eq(noProof.status, 401, "POST /accounts without a code: status");
    eq(
      errorCode(noProof.body),
      "proof_required",
      "POST /accounts without a code: error code",
    );

    const { codeId, code } = await requestCode(ctx, email);
    const { account } = await createAccount(ctx.cfg, {
      email,
      proof: { codeId, code },
      sessionPublicKey: newSessionKey().publicKeyUncompressed,
    }).catch((e: unknown) => {
      if (e instanceof AccountsError)
        throw new Failure(`claim with a code failed: ${e.message}`);
      throw e;
    });
    check(
      /^did:dimo:[a-z2-7]{24}$/.test(account.did),
      `claim returned a malformed DID ${account.did}`,
    );
    eq(
      account.subOrganizationId,
      subOrganizationId,
      "claim keeps the v1 sub-organization",
    );
    await assertEndUserOnlyRoot(ctx, subOrganizationId, email);
    return `without a code 401 proof_required; with a code ${account.did}, quorum=[end user]`;
  },
};
