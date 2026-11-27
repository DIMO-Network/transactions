import type { TurnkeyClient } from "@turnkey/http";
import { describe, expect, it, vi } from "vitest";

import { removePhone } from "../../../src/accounts/account/phone.js";

function client(opts: { fail?: boolean } = {}) {
  const updateUserPhoneNumber = vi.fn(async () => {
    if (opts.fail) throw new Error("turnkey refused");
    return { activity: { id: "a", status: "ACTIVITY_STATUS_COMPLETED", result: {} } };
  });
  const getWhoami = vi.fn(async () => ({ organizationId: "sub-1", userId: "end-user" }));
  return {
    updateUserPhoneNumber,
    getWhoami,
    c: { updateUserPhoneNumber, getWhoami } as unknown as TurnkeyClient,
  };
}

describe("removePhone (fix round 2)", () => {
  it("clears the user's phone number (UPDATE_USER_PHONE_NUMBER with an empty number) in the sub-org", async () => {
    const { c, updateUserPhoneNumber, getWhoami } = client();
    await removePhone(c, { subOrganizationId: "sub-1", userId: "end-user" });
    expect(getWhoami).not.toHaveBeenCalled();
    expect(updateUserPhoneNumber).toHaveBeenCalledTimes(1);
    expect(updateUserPhoneNumber.mock.calls[0]).toEqual([
      expect.objectContaining({
        type: "ACTIVITY_TYPE_UPDATE_USER_PHONE_NUMBER",
        organizationId: "sub-1",
        parameters: { userId: "end-user", userPhoneNumber: "" },
        timestampMs: expect.stringMatching(/^\d+$/),
      }),
    ]);
  });

  it("without userId, uses the stamping user from whoami on the sub-org", async () => {
    const { c, updateUserPhoneNumber, getWhoami } = client();
    await removePhone(c, { subOrganizationId: "sub-1" });
    expect(getWhoami).toHaveBeenCalledWith({ organizationId: "sub-1" });
    expect(updateUserPhoneNumber.mock.calls[0]).toEqual([
      expect.objectContaining({ parameters: { userId: "end-user", userPhoneNumber: "" } }),
    ]);
  });

  it("a Turnkey failure propagates", async () => {
    const { c } = client({ fail: true });
    await expect(removePhone(c, { subOrganizationId: "sub-1", userId: "u" })).rejects.toThrow("turnkey refused");
  });
});
