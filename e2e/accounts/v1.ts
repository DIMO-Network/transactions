/** v1 account creation (setup for E8 and E9): POST /api/account. */
import { randomBytes } from "node:crypto";
import { normalizeUrl } from "../src/index.js";
import { makePasskey } from "./software-authenticator.js";
import { Failure, type Ctx } from "./harness.js";

/**
 * A passkey made in software, with the registration challenge and clientDataJSON a
 * browser would produce (type webauthn.create), as v1's attestation body.
 */
export function softwareAttestation(ctx: Ctx) {
  const passkey = makePasskey({ rpId: ctx.env.rpId });
  const challenge = randomBytes(32).toString("base64url");
  const clientDataJson = Buffer.from(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
      origin: ctx.env.origin,
      crossOrigin: false,
    }),
  ).toString("base64url");
  return {
    encodedChallenge: challenge,
    attestation: {
      credentialId: passkey.credentialId,
      clientDataJson,
      attestationObject: passkey.attestationObject,
      transports: ["AUTHENTICATOR_TRANSPORT_INTERNAL"],
    },
  };
}

/** v1 POST /api/account; returns the sub-organization id from the 201 body. */
export async function v1Create(
  ctx: Ctx,
  body: Record<string, unknown>,
): Promise<{ subOrganizationId: string }> {
  const res = await globalThis.fetch(
    `${normalizeUrl(ctx.env.ACCOUNTS_URL)}/api/account`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetChain: "POLYGON", ...body }),
    },
  );
  const text = await res.text();
  if (res.status !== 201) {
    throw new Failure(
      `setup: v1 POST /api/account answered ${res.status} (expected 201; 401 means ACCOUNT_CREATE_REQUIRE_PROOF is on): ${text.slice(0, 200)}`,
    );
  }
  const out = JSON.parse(text) as { subOrganizationId?: unknown };
  if (typeof out.subOrganizationId !== "string") {
    throw new Failure("setup: v1 response has no subOrganizationId");
  }
  return { subOrganizationId: out.subOrganizationId };
}
