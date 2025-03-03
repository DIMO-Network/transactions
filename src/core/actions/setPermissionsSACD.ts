import { encodeFunctionData } from "viem";
import { ContractToMapping, ContractType, ENVIRONMENT, SACDTemplate } from ":core/types/dimo.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { SET_PERMISSIONS_SACD } from ":core/constants/methods.js";
import {
  SACDTemplateInputs,
  SetPermissionsSACD,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
} from ":core/types/args.js";
import { v4 as uuidv4 } from "uuid";
import { sacdDescription, sacdPermissionArray } from ":core/utils/utils.js";

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
          arg.permissions,
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
          arg.permissions,
          arg.expiration,
          arg.source,
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
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_PERMISSIONS_SACD,
        args: [args.asset, args.tokenId, args.grantee, args.permissions, args.expiration, args.source],
      }),
    },
  ]);
}

export function sacdCallData(args: SetPermissionsSACD, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SACD].abi,
    functionName: SET_PERMISSIONS_SACD,
    args: [args.asset, args.tokenId, args.grantee, args.permissions, args.expiration, args.source],
  });
}

export const generateSACDTemplate = async (args: SACDTemplateInputs): Promise<SACDTemplate> => {
  const templateId = uuidv4();
  const permissionArray = sacdPermissionArray(args.permissions);

  const currentTime = new Date();
  const description = sacdDescription({
    driverID: args.driverID,
    appID: args.appID,
    appName: args.appName,
    expiration: args.expiration,
    permissionArray: permissionArray,
    effectiveAt: currentTime.toISOString(),
  });

  const template: SACDTemplate = {
    specVersion: "1.0",
    id: templateId,
    type: "org.dimo.permission.grant.v1",
    datacontentype: "application/json",
    time: currentTime.toISOString(),
    data: {
      templateId: templateId,
      version: "1.0",
      grantor: args.grantor,
      grantee: args.grantee,
      scope: {
        permissions: permissionArray,
      },
      effectiveAt: currentTime.toISOString(),
      expiresAt: new Date(Number(args.expiration) * 1000).toISOString(),
      attachments: args.attachments,
      description: description,
    },
  };

  return template;
};
