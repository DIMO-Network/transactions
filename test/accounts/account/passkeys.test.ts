import type { TurnkeyClient } from "@turnkey/http";
import { describe, expect, it, vi } from "vitest";

import { addPasskey, removePasskey } from "../../../src/accounts/account/passkeys.js";

const att = {
  credentialId: "c",
  clientDataJson: "d",
  attestationObject: "o",
  transports: ["AUTHENTICATOR_TRANSPORT_INTERNAL" as const],
};

function client(ids: string[]) {
  const createAuthenticators = vi.fn(async () => ({
    activity: {
      id: "a",
      status: "ACTIVITY_STATUS_COMPLETED",
      result: {
        createAuthenticatorsResult: { authenticatorIds: ["auth-new"] },
      },
    },
  }));
  const deleteAuthenticators = vi.fn(async () => ({
    activity: { id: "b", status: "ACTIVITY_STATUS_COMPLETED", result: {} },
  }));
  const getAuthenticators = vi.fn(async () => ({
    authenticators: ids.map((authenticatorId) => ({ authenticatorId })),
  }));
  return {
    createAuthenticators,
    deleteAuthenticators,
    getAuthenticators,
    c: {
      createAuthenticators,
      deleteAuthenticators,
      getAuthenticators,
    } as unknown as TurnkeyClient,
  };
}

describe("addPasskey", () => {
  it("sends CREATE_AUTHENTICATORS_V2 for the sub-org's end user", async () => {
    const { c, createAuthenticators } = client([]);
    const r = await addPasskey(c, {
      subOrganizationId: "sub",
      userId: "u1",
      attestation: att,
      challenge: "ch",
      name: "Phone",
    });
    expect(r).toEqual({ authenticatorId: "auth-new" });
    const arg = (createAuthenticators.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg.type).toBe("ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2");
    expect(arg.organizationId).toBe("sub");
    expect(arg.parameters).toEqual({
      userId: "u1",
      authenticators: [{ authenticatorName: "Phone", challenge: "ch", attestation: att }],
    });
  });
});

describe("removePasskey", () => {
  const args = {
    subOrganizationId: "sub",
    userId: "u1",
    authenticatorId: "a1",
  };
  it("refuses the last authenticator by default", async () => {
    const { c, deleteAuthenticators, getAuthenticators } = client(["a1"]);
    await expect(removePasskey(c, args)).rejects.toMatchObject({
      name: "UsageError",
      code: "last_passkey",
    });
    expect(getAuthenticators).toHaveBeenCalledWith({
      organizationId: "sub",
      userId: "u1",
    });
    expect(deleteAuthenticators).not.toHaveBeenCalled();
  });
  it("removes the last one with allowLast", async () => {
    const { c, deleteAuthenticators } = client(["a1"]);
    await removePasskey(c, { ...args, allowLast: true });
    const arg = (deleteAuthenticators.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg.type).toBe("ACTIVITY_TYPE_DELETE_AUTHENTICATORS");
    expect(arg.parameters).toEqual({ userId: "u1", authenticatorIds: ["a1"] });
  });
  it("removes when others remain", async () => {
    const { c, deleteAuthenticators } = client(["a1", "a2"]);
    await removePasskey(c, args);
    expect(deleteAuthenticators).toHaveBeenCalledOnce();
  });
});
