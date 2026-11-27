import { KernelAccountClient } from "@zerodev/sdk";
import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { Permission, SetAccountPermissions, SetVehiclePermissions } from ":core/types/args.js";
import { ContractType } from ":core/types/dimo.js";
import { accountPermissionsCalls, vehiclePermissionsBulkCalls, vehiclePermissionsCalls } from "./permissionCalls.js";
import {
  setAccountPermissions,
  setAccountPermissionsBatch,
  setAccountPermissionsCallData,
} from "./setAccountPermissionsSACD.js";
import {
  sacdCallData,
  setVehiclePermissions,
  setVehiclePermissionsBatch,
  setVehiclePermissionsBulk,
} from "./setPermissionsSACD.js";

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
const SOURCE = "ipfs://source";
const EXPIRATION = BigInt(1_900_000_000);
const vehicle = (tokenId: number, templateId?: number): SetVehiclePermissions => ({
  tokenId: BigInt(tokenId),
  grantee,
  permissions: [Permission.GetCurrentLocation, Permission.ExecuteCommands],
  expiration: EXPIRATION,
  templateId: templateId === undefined ? undefined : BigInt(templateId),
  source: SOURCE,
});
const account = (templateId: number): SetAccountPermissions => ({
  grantee,
  permissions: [Permission.GetNonLocationHistory],
  expiration: EXPIRATION,
  templateId: BigInt(templateId),
  source: SOURCE,
});

/** Calldata pinned from a hand-checked encoding: vehicle token 7, template 3 / account template 4. */
const GOLDEN: Record<string, { vehicle: `0x${string}`; account: `0x${string}` }> = {
  prod: {
    vehicle:
      "0x02e690e4000000000000000000000000ba5738a18d83d41847dffbdc6101d37c69c9b0cf0000000000000000000000000000000000000000000000000000000000000007000000000000000000000000098765432109876543210987654321098765432100000000000000000000000000000000000000000000000000000000000000f000000000000000000000000000000000000000000000000000000000713fb300000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000d697066733a2f2f736f7572636500000000000000000000000000000000000000",
    account:
      "0x271c6d390000000000000000000000000987654321098765432109876543210987654321000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000713fb300000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000d697066733a2f2f736f7572636500000000000000000000000000000000000000",
  },
  dev: {
    vehicle:
      "0x02e690e400000000000000000000000045fbcd3ef7361d156e8b16f5538ae36dedf61da80000000000000000000000000000000000000000000000000000000000000007000000000000000000000000098765432109876543210987654321098765432100000000000000000000000000000000000000000000000000000000000000f000000000000000000000000000000000000000000000000000000000713fb300000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000d697066733a2f2f736f7572636500000000000000000000000000000000000000",
    account:
      "0x271c6d390000000000000000000000000987654321098765432109876543210987654321000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000713fb300000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000d697066733a2f2f736f7572636500000000000000000000000000000000000000",
  },
};

describe.each(["prod", "dev"])("permission call builders (%s)", (env) => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(env)!].contracts;
  const sacd = contracts[ContractType.DIMO_SACD];
  const vehicleId = contracts[ContractType.DIMO_VEHICLE_ID].address;
  /** The vehicle call data from the independent single-call encoder, not from the builder. */
  const expectedVehicleData = (a: SetVehiclePermissions) =>
    sacdCallData(
      {
        asset: vehicleId,
        tokenId: a.tokenId,
        grantee: a.grantee,
        permissions: a.permissions,
        expiration: a.expiration,
        templateId: a.templateId,
        source: a.source,
      },
      env
    );
  const shape = (calls: Calls) => calls.map((c) => ({ to: c.to, value: c.value }));

  it("vehicle single: data equals sacdCallData, matches the pinned encoding and decoded args", () => {
    const calls = vehiclePermissionsCalls(vehicle(7, 3), env);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(sacd.address);
    expect(calls[0]!.value).toBe(BigInt(0));
    expect(calls[0]!.data).toBe(expectedVehicleData(vehicle(7, 3)));
    expect(calls[0]!.data).toBe(GOLDEN[env]!.vehicle);
    const { functionName, args } = decodeFunctionData({ abi: sacd.abi, data: calls[0]!.data });
    expect(functionName).toBe("setPermissions");
    expect(args).toEqual([vehicleId, BigInt(7), grantee, BigInt(0xf0), EXPIRATION, BigInt(3), SOURCE]);
  });

  it("vehicle: a missing templateId encodes as 0", () => {
    expect(vehiclePermissionsCalls(vehicle(7), env)[0]!.data).toBe(
      expectedVehicleData({ ...vehicle(7), templateId: BigInt(0) })
    );
    expect(vehiclePermissionsCalls(vehicle(7), env)[0]!.data).toBe(expectedVehicleData(vehicle(7)));
  });

  it("vehicle batch: one call per entry, each data equals sacdCallData, same list the action encodes", async () => {
    const args = [vehicle(7), vehicle(8, 2)];
    const calls = vehiclePermissionsCalls(args, env);
    expect(calls.map((c) => c.data)).toEqual(args.map(expectedVehicleData));
    expect(shape(calls)).toEqual(args.map(() => ({ to: sacd.address, value: BigInt(0) })));
    const { client, seen } = stub();
    await setVehiclePermissionsBatch(args, client, env);
    expect(seen.calls).toEqual(calls);
    const one = stub();
    await setVehiclePermissions(vehicle(7, 3), one.client, env);
    expect(one.seen.calls).toEqual(vehiclePermissionsCalls(vehicle(7, 3), env));
  });

  it("vehicle bulk: one call per token id, each data equals sacdCallData", async () => {
    const { tokenId: _t, ...rest } = vehicle(1, 5);
    const bulk = { ...rest, tokenIds: [BigInt(1), BigInt(2), BigInt(3)] };
    const calls = vehiclePermissionsBulkCalls(bulk, env);
    expect(calls.map((c) => c.data)).toEqual([1, 2, 3].map((id) => expectedVehicleData({ ...vehicle(id, 5) })));
    const { client, seen } = stub();
    await setVehiclePermissionsBulk(bulk, client, env);
    expect(seen.calls).toEqual(calls);
  });

  it("account single: data equals setAccountPermissionsCallData, matches the pinned encoding and decoded args", async () => {
    const calls = accountPermissionsCalls(account(4), env);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe(sacd.address);
    expect(calls[0]!.value).toBe(BigInt(0));
    expect(calls[0]!.data).toBe(setAccountPermissionsCallData(account(4), env));
    expect(calls[0]!.data).toBe(GOLDEN[env]!.account);
    const { functionName, args } = decodeFunctionData({ abi: sacd.abi, data: calls[0]!.data });
    expect(functionName).toBe("setAccountPermissions");
    expect(args).toEqual([grantee, BigInt(0x0c), EXPIRATION, BigInt(4), SOURCE]);
    const { client, seen } = stub();
    await setAccountPermissions(account(4), client, env);
    expect(seen.calls).toEqual(calls);
  });

  it("account batch: one call per entry, each data equals setAccountPermissionsCallData", async () => {
    const args = [account(4), account(9)];
    const calls = accountPermissionsCalls(args, env);
    expect(calls.map((c) => c.data)).toEqual(args.map((a) => setAccountPermissionsCallData(a, env)));
    expect(shape(calls)).toEqual(args.map(() => ({ to: sacd.address, value: BigInt(0) })));
    const { client, seen } = stub();
    await setAccountPermissionsBatch(args, client, env);
    expect(seen.calls).toEqual(calls);
  });
});

it("prod and dev builders produce different calls", () => {
  expect(vehiclePermissionsCalls(vehicle(1), "prod")).not.toEqual(vehiclePermissionsCalls(vehicle(1), "dev"));
});
