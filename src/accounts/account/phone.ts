import { createActivityPoller, type TurnkeyClient } from "@turnkey/http";

/**
 * Remove the end user's phone number from their Turnkey sub-org
 * (ACTIVITY_TYPE_UPDATE_USER_PHONE_NUMBER with an empty number). claimDid's PUT
 * /api/v2/me/did answers 409 `remove_phone_first` (RemovePhoneFirstError) while a v1
 * sub-org that DIMO has already left still holds one: call this, then claimDid again.
 *
 * `turnkey` must stamp with the user's own credential for the sub-org (their passkey, or
 * the session key from an email login), as for addPasskey and deleteAccount. `userId`
 * defaults to the stamping user (whoami on the sub-org). Turnkey-only: no SdkConfig, no
 * SDK fetch calls. Turnkey errors propagate as they are.
 */
export async function removePhone(
  turnkey: TurnkeyClient,
  args: { subOrganizationId: string; userId?: string }
): Promise<void> {
  const userId = args.userId ?? (await turnkey.getWhoami({ organizationId: args.subOrganizationId })).userId;
  const poller = createActivityPoller({
    client: turnkey,
    requestFn: turnkey.updateUserPhoneNumber,
  });
  await poller({
    type: "ACTIVITY_TYPE_UPDATE_USER_PHONE_NUMBER",
    timestampMs: String(Date.now()),
    organizationId: args.subOrganizationId,
    parameters: { userId, userPhoneNumber: "" },
  });
}
