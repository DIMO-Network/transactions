import { describe, it, expect, vi } from "vitest";
import { generatePermissionsSACDTemplate } from "./setPermissionsSACD.js";
import { Permission } from "../types/args.js";

// Mock Date.now to ensure consistent timestamps in tests
const mockDate = new Date("2024-01-15T10:30:00.000Z");
vi.setSystemTime(mockDate);

describe("generatePermissionsSACDTemplate", () => {
  const baseInputs = {
    grantor: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    grantee: "0x0987654321098765432109876543210987654321" as `0x${string}`,
    asset: "did:asset:test-vehicle-123" as `did:${string}`,
    permissions: [Permission.GetCurrentLocation, Permission.ExecuteCommands],
    attachments: [
      {
        name: "test-attachment",
        description: "Test attachment description",
        contentType: "application/json",
        url: "https://example.com/attachment.json",
      },
    ],
    expiration: BigInt(Math.floor(Date.now() / 1000) + 86400), // 24 hours from now
  };

  it("should generate a valid SACD template with basic inputs", async () => {
    const result = await generatePermissionsSACDTemplate(baseInputs);

    expect(result).toMatchObject({
      specVersion: "1.0",
      time: mockDate.toISOString(),
      type: "dimo.sacd",
      signature: "0x",
    });

    expect(result.data).toMatchObject({
      grantor: {
        address: baseInputs.grantor,
      },
      grantee: {
        address: baseInputs.grantee,
      },
      effectiveAt: mockDate.toISOString(),
      expiresAt: new Date(Number(baseInputs.expiration) * 1000).toISOString(),
      additionalDates: {},
    });

    expect(result.data.agreements).toHaveLength(1);
    expect(result.data.agreements[0]).toMatchObject({
      type: "permission",
      asset: baseInputs.asset,
      attachments: baseInputs.attachments,
      extensions: {},
    });

    // Check permissions array (order may vary)
    const permissionAgreement = result.data.agreements[0] as any;
    expect(permissionAgreement.permissions).toHaveLength(2);
    expect(permissionAgreement.permissions).toEqual(
      expect.arrayContaining([{ name: "privilege:GetCurrentLocation" }, { name: "privilege:ExecuteCommands" }])
    );
  });

  it("should include cloud event agreements when provided", async () => {
    const inputsWithCloudEvents = {
      ...baseInputs,
      cloudEventAgreements: [
        {
          source: "0xabcdef1234567890abcdef1234567890abcdef12" as `0x${string}`,
          ids: ["event-1", "event-2"],
          tags: ["location", "telemetry"],
          eventType: "dimo.fingerprint",
        },
        {
          source: "0xfedcba0987654321fedcba0987654321fedcba09" as `0x${string}`,
          ids: ["event-3"],
          tags: ["diagnostic"],
        },
      ],
    };

    const result = await generatePermissionsSACDTemplate(inputsWithCloudEvents);

    expect(result.data.agreements).toHaveLength(3); // 1 permission + 2 cloud events

    // Check permission agreement
    expect(result.data.agreements[0]).toMatchObject({
      type: "permission",
      asset: baseInputs.asset,
    });

    // Check cloud event agreements
    expect(result.data.agreements[1]).toMatchObject({
      type: "cloudevent",
      eventType: "dimo.fingerprint",
      source: inputsWithCloudEvents.cloudEventAgreements![0].source,
      asset: baseInputs.asset,
      ids: inputsWithCloudEvents.cloudEventAgreements![0].ids,
      tags: inputsWithCloudEvents.cloudEventAgreements![0].tags,
      effectiveAt: mockDate.toISOString(),
      expiresAt: new Date(Number(baseInputs.expiration) * 1000).toISOString(),
    });

    expect(result.data.agreements[2]).toMatchObject({
      type: "cloudevent",
      eventType: "dimo.attestation",
      source: inputsWithCloudEvents.cloudEventAgreements![1].source,
      asset: baseInputs.asset,
      ids: inputsWithCloudEvents.cloudEventAgreements![1].ids,
      tags: inputsWithCloudEvents.cloudEventAgreements![1].tags,
      effectiveAt: mockDate.toISOString(),
      expiresAt: new Date(Number(baseInputs.expiration) * 1000).toISOString(),
    });
  });

  it("should handle empty cloud event agreements array", async () => {
    const inputsWithEmptyCloudEvents = {
      ...baseInputs,
      cloudEventAgreements: [],
    };

    const result = await generatePermissionsSACDTemplate(inputsWithEmptyCloudEvents);

    expect(result.data.agreements).toHaveLength(1); // Only permission agreement
    expect(result.data.agreements[0].type).toBe("permission");
  });

  it("should handle all permission types correctly", async () => {
    const allPermissions = Object.values(Permission).filter((value): value is Permission => typeof value === "number");

    const inputsWithAllPermissions = {
      ...baseInputs,
      permissions: allPermissions,
    };

    const result = await generatePermissionsSACDTemplate(inputsWithAllPermissions);

    const expectedPermissionNames = allPermissions.map((permission) => ({
      name: `privilege:${Permission[permission]}`,
    }));

    const permissionAgreement = result.data.agreements[0] as any;
    expect(permissionAgreement.permissions).toEqual(expectedPermissionNames);
  });

  it("should throw error when args are null or undefined", async () => {
    await expect(generatePermissionsSACDTemplate(null as any)).rejects.toThrow("SACD inputs are required");

    await expect(generatePermissionsSACDTemplate(undefined as any)).rejects.toThrow("SACD inputs are required");
  });

  it("should handle empty permissions array", async () => {
    const inputsWithNoPermissions = {
      ...baseInputs,
      permissions: [],
    };

    const result = await generatePermissionsSACDTemplate(inputsWithNoPermissions);

    const permissionAgreement = result.data.agreements[0] as any;
    expect(permissionAgreement.permissions).toEqual([]);
  });

  it("should handle empty attachments array", async () => {
    const inputsWithNoAttachments = {
      ...baseInputs,
      attachments: [],
    };

    const result = await generatePermissionsSACDTemplate(inputsWithNoAttachments);

    const permissionAgreement = result.data.agreements[0] as any;
    expect(permissionAgreement.attachments).toEqual([]);
  });

  it("should correctly convert expiration timestamp to ISO string", async () => {
    const specificExpiration = BigInt(1705320600); // 2024-01-15T12:30:00Z
    const inputsWithSpecificExpiration = {
      ...baseInputs,
      expiration: specificExpiration,
    };

    const result = await generatePermissionsSACDTemplate(inputsWithSpecificExpiration);

    const expectedExpiration = new Date(Number(specificExpiration) * 1000).toISOString();
    expect(result.data.expiresAt).toBe(expectedExpiration);
  });

  it("should use current time for effectiveAt", async () => {
    const result = await generatePermissionsSACDTemplate(baseInputs);

    expect(result.data.effectiveAt).toBe(mockDate.toISOString());
    expect(result.time).toBe(mockDate.toISOString());
  });
});
