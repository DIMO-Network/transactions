import { describe, expect, it } from "vitest";
import { KernelAccountClient } from "@zerodev/sdk";
import { Permission, SetAccountPermissions, SetVehiclePermissions } from ":core/types/args.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ContractType } from ":core/types/dimo.js";
import { accountPermissionsCalls, vehiclePermissionsBulkCalls, vehiclePermissionsCalls } from "./permissionCalls.js";
import { setAccountPermissions, setAccountPermissionsBatch } from "./setAccountPermissionsSACD.js";
import { setVehiclePermissions, setVehiclePermissionsBatch, setVehiclePermissionsBulk } from "./setPermissionsSACD.js";

type Calls = Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }>;

/** A stub kernel client whose encodeCalls records its input. */
function stub() {
  const seen: { calls?: Calls } = {};
  const client = {
    account: {
      encodeCalls: async (calls: Calls) => {
        seen.calls = calls;
        return "0x" as const;
      },
    },
  } as unknown as KernelAccountClient;
  return { client, seen };
}

const grantee = "0x0987654321098765432109876543210987654321" as const;
const vehicle = (tokenId: bigint, templateId?: bigint): SetVehiclePermissions => ({
  tokenId,
  grantee,
  permissions: [Permission.GetCurrentLocation, Permission.ExecuteCommands],
  expiration: BigInt(1_900_000_000),
  templateId,
  source: "ipfs://source",
});
const account = (templateId: bigint): SetAccountPermissions => ({
  grantee,
  permissions: [Permission.GetNonLocationHistory],
  expiration: BigInt(1_900_000_000),
  templateId,
  source: "ipfs://source",
});

describe.each(["prod", "dev"])("permission call builders (%s)", (env) => {
  const sacd = CHAIN_ABI_MAPPING[ENV_MAPPING.get(env)!].contracts[ContractType.DIMO_SACD].address;

  it("vehiclePermissionsCalls matches setVehiclePermissions", async () => {
    const { client, seen } = stub();
    await setVehiclePermissions(vehicle(BigInt(7), BigInt(3)), client, env);
    expect(vehiclePermissionsCalls(vehicle(BigInt(7), BigInt(3)), env)).toEqual(seen.calls);
    expect(seen.calls![0]!.to).toBe(sacd);
  });

  it("vehiclePermissionsCalls matches setVehiclePermissionsBatch and defaults templateId to 0", async () => {
    const { client, seen } = stub();
    const args = [vehicle(BigInt(7)), vehicle(BigInt(8), BigInt(2))];
    await setVehiclePermissionsBatch(args, client, env);
    expect(vehiclePermissionsCalls(args, env)).toEqual(seen.calls);
    expect(seen.calls).toHaveLength(2);
    expect(vehiclePermissionsCalls(vehicle(BigInt(7)), env)[0]).toEqual(vehiclePermissionsCalls(vehicle(BigInt(7), BigInt(0)), env)[0]);
  });

  it("vehiclePermissionsBulkCalls matches setVehiclePermissionsBulk", async () => {
    const { client, seen } = stub();
    const { tokenId: _t, ...rest } = vehicle(BigInt(1), BigInt(5));
    const bulk = { ...rest, tokenIds: [BigInt(1), BigInt(2), BigInt(3)] };
    await setVehiclePermissionsBulk(bulk, client, env);
    expect(vehiclePermissionsBulkCalls(bulk, env)).toEqual(seen.calls);
    expect(seen.calls).toHaveLength(3);
  });

  it("accountPermissionsCalls matches setAccountPermissions and setAccountPermissionsBatch", async () => {
    const one = stub();
    await setAccountPermissions(account(BigInt(4)), one.client, env);
    expect(accountPermissionsCalls(account(BigInt(4)), env)).toEqual(one.seen.calls);

    const many = stub();
    const args = [account(BigInt(4)), account(BigInt(9))];
    await setAccountPermissionsBatch(args, many.client, env);
    expect(accountPermissionsCalls(args, env)).toEqual(many.seen.calls);
    expect(many.seen.calls).toHaveLength(2);
  });
});

it("prod and dev builders produce different calls", () => {
  expect(vehiclePermissionsCalls(vehicle(BigInt(1)), "prod")).not.toEqual(vehiclePermissionsCalls(vehicle(BigInt(1)), "dev"));
});
