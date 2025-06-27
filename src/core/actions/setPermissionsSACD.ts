import { encodeFunctionData } from "viem";
import { ContractToMapping, ContractType, ENVIRONMENT, SACDTemplate } from ":core/types/dimo.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { SET_PERMISSIONS_SACD } from ":core/constants/methods.js";
import {
  Permission,
  PermissionsSACDTemplateInputs,
  SetPermissionsSACD,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
} from ":core/types/args.js";

export async function setVehiclePermissions(
  args: SetVehiclePermissions,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await setPermissionsSACD(
    {
      asset: contracts[ContractType.DIMO_VEHICLE_ID].address,
      tokenId: args.tokenId,
      grantee: args.grantee,
      permissions: args.permissions,
      expiration: args.expiration,
      source: args.source,
    },
    client,
    contracts
  );
}

export async function setVehiclePermissionsBulk(
  arg: SetVehiclePermissionsBulk,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const permissionValue = getPermissionsValue(arg.permissions);

  const callData = arg.tokenIds.map((tokenId) => {
    return {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_PERMISSIONS_SACD,
        args: [
          contracts[ContractType.DIMO_VEHICLE_ID].address,
          tokenId,
          arg.grantee,
          permissionValue,
          arg.expiration,
          arg.source,
        ],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}

export async function setVehiclePermissionsBatch(
  args: SetVehiclePermissions[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const callData = args.map((arg) => {
    const permissionValue = getPermissionsValue(arg.permissions);

    return {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_PERMISSIONS_SACD,
        args: [
          contracts[ContractType.DIMO_VEHICLE_ID].address,
          arg.tokenId,
          arg.grantee,
          permissionValue,
          arg.expiration,
          arg.source
        ],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}

export async function setPermissionsSACD(
  args: SetPermissionsSACD,
  client: KernelAccountClient,
  contracts: ContractToMapping
): Promise<`0x${string}`> {

  const permissionValue = getPermissionsValue(args.permissions);

  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_PERMISSIONS_SACD,
        args: [
          args.asset,
          args.tokenId,
          args.grantee,
          permissionValue,
          args.expiration,
          args.source
        ],
      }),
    },
  ]);
}

export function sacdCallData(args: SetPermissionsSACD, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const { permissions } = args;
  const permissionKeys = Object.keys(Permission).map((key) =>
    permissions.includes(Permission[key as keyof typeof Permission]) ? "11" : "00"
  );

  const permissionValue = BigInt(`0b${permissionKeys.join("")}00`);
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SACD].abi,
    functionName: SET_PERMISSIONS_SACD,
    args: [
      args.asset,
      args.tokenId,
      args.grantee,
      permissionValue,
      args.expiration,
      args.source
    ],
  });
}

export const generatePermissionsSACDTemplate = async (args: PermissionsSACDTemplateInputs): Promise<SACDTemplate> => {
  if (!args) {
    throw new Error("SACD inputs are required");
  }

  const { grantor, grantee, asset, permissions, attachments } = args;
  const now = new Date(Date.now());
  const expiration = new Date(Number(args.expiration) * 1000);

  const permissionKeys = Object.keys(Permission).filter((key) =>
    permissions.includes(Permission[key as keyof typeof Permission])
  );

  const sacd: SACDTemplate = {
    specVersion: "1.0",
    time: now.toISOString(),
    type: "dimo.sacd",
    data: {
      grantor: {
        address: grantor,
      },
      grantee: {
        address: grantee,
      },
      effectiveAt: now.toISOString(),
      expiresAt: expiration.toISOString(),
      additionalDates: {},
      agreements: [
        {
          type: "permission",
          asset: asset,
          permissions: permissionKeys.map((permission) => ({
            name: `privilege:${permission}`,
          })),
          attachments: attachments,
          extensions: {},
        },
      ],
    },
    signature: "0x", // Placeholder for signature, to be filled in later
  };

  return sacd;
};

const getPermissionsValue = (permissions: Permission[]): bigint => {
  const permissionKeys = Object.keys(Permission).map((key) =>
    permissions.includes(Permission[key as keyof typeof Permission]) ? "11" : "00"
  );

  return BigInt(`0b${permissionKeys.join("")}00`);
};

//TODO: check if this is the best way to convert permissions to an array
export function getPermissionsArray(permissionValue: bigint): Permission[] {
  const permissionKeys = Object.keys(Permission);
  const permissions: Permission[] = [];

  for (let i = 0; i < permissionKeys.length; i++) {
    const bit = (permissionValue >> (permissionKeys.length - 1 - i)) & BigInt(1);
    if (bit === BigInt(1)) {
      permissions.push(Permission[permissionKeys[i] as keyof typeof Permission]);
    }
  }

  return permissions;
}


