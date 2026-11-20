import { createActivityPoller, type TurnkeyClient } from "@turnkey/http";
import { TurnkeyError, UsageError } from "../errors.js";

/** Turnkey's authenticator transports, as addPasskey sends them. */
export type PasskeyTransport =
  | "AUTHENTICATOR_TRANSPORT_BLE"
  | "AUTHENTICATOR_TRANSPORT_INTERNAL"
  | "AUTHENTICATOR_TRANSPORT_NFC"
  | "AUTHENTICATOR_TRANSPORT_USB"
  | "AUTHENTICATOR_TRANSPORT_HYBRID"
  | "AUTHENTICATOR_TRANSPORT_SMART_CARD";

export type PasskeyAttestation = {
  credentialId: string;
  clientDataJson: string;
  attestationObject: string;
  transports: PasskeyTransport[];
};

/**
 * Register a new passkey (ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2) for the sub-org's end user.
 * Turnkey-only, like removePasskey: these talk to Turnkey through the caller's stamped
 * client and make no SDK fetch calls, so they take the client instead of an SdkConfig.
 */
export async function addPasskey(
  turnkey: TurnkeyClient,
  args: {
    subOrganizationId: string;
    userId: string;
    attestation: PasskeyAttestation;
    challenge: string;
    name: string;
  },
): Promise<{ authenticatorId: string }> {
  const poller = createActivityPoller({
    client: turnkey,
    requestFn: turnkey.createAuthenticators,
  });
  const activity = await poller({
    type: "ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2",
    timestampMs: String(Date.now()),
    organizationId: args.subOrganizationId,
    parameters: {
      userId: args.userId,
      authenticators: [
        {
          authenticatorName: args.name,
          challenge: args.challenge,
          attestation: args.attestation,
        },
      ],
    },
  });
  const id = activity.result.createAuthenticatorsResult?.authenticatorIds[0];
  if (!id)
    throw new TurnkeyError(
      "no_authenticator_id",
      "Turnkey returned no authenticator id",
    );
  return { authenticatorId: id };
}

/**
 * Remove a passkey (ACTIVITY_TYPE_DELETE_AUTHENTICATORS). Refuses to remove the user's last
 * authenticator unless `allowLast` is set (UsageError `last_passkey`): the email code still
 * recovers the account, but that should be the user's choice.
 */
export async function removePasskey(
  turnkey: TurnkeyClient,
  args: {
    subOrganizationId: string;
    userId: string;
    authenticatorId: string;
    allowLast?: boolean;
  },
): Promise<void> {
  if (!args.allowLast) {
    const { authenticators } = await turnkey.getAuthenticators({
      organizationId: args.subOrganizationId,
      userId: args.userId,
    });
    const others = authenticators.filter(
      (a) => a.authenticatorId !== args.authenticatorId,
    );
    if (others.length === 0) {
      throw new UsageError(
        "last_passkey",
        "refusing to remove the user's last passkey; pass { allowLast: true } to override",
      );
    }
  }
  const poller = createActivityPoller({
    client: turnkey,
    requestFn: turnkey.deleteAuthenticators,
  });
  await poller({
    type: "ACTIVITY_TYPE_DELETE_AUTHENTICATORS",
    timestampMs: String(Date.now()),
    organizationId: args.subOrganizationId,
    parameters: {
      userId: args.userId,
      authenticatorIds: [args.authenticatorId],
    },
  });
}
