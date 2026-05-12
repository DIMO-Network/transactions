import { encodeFunctionData } from "viem";
import { ContractToMapping, ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { RENOUNCE_PERMISSIONS_SACD } from ":core/constants/methods.js";
import {
  RenouncePermissionsSACD,
  RenounceVehiclePermissions,
  RenounceVehiclePermissionsBulk,
} from ":core/types/args.js";

export async function renounceVehiclePermissions(
  args: RenounceVehiclePermissions,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await renouncePermissionsSACD(
    {
      asset: contracts[ContractType.DIMO_VEHICLE_ID].address,
      tokenId: args.tokenId,
    },
    client,
    contracts
  );
}

export async function renounceVehiclePermissionsBulk(
  arg: RenounceVehiclePermissionsBulk,
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
        functionName: RENOUNCE_PERMISSIONS_SACD,
        args: [contracts[ContractType.DIMO_VEHICLE_ID].address, tokenId],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}

export async function renounceVehiclePermissionsBatch(
  args: RenounceVehiclePermissions[],
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
        functionName: RENOUNCE_PERMISSIONS_SACD,
        args: [contracts[ContractType.DIMO_VEHICLE_ID].address, arg.tokenId],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}

export async function renouncePermissionsSACD(
  args: RenouncePermissionsSACD,
  client: KernelAccountClient,
  contracts: ContractToMapping
): Promise<`0x${string}`> {
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: RENOUNCE_PERMISSIONS_SACD,
        args: [args.asset, args.tokenId],
      }),
    },
  ]);
}

export function renouncePermissionsCallData(
  args: RenouncePermissionsSACD,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SACD].abi,
    functionName: RENOUNCE_PERMISSIONS_SACD,
    args: [args.asset, args.tokenId],
  });
}
