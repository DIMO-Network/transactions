import { KernelAccountClient } from "@zerodev/sdk";
import {
  Account,
  Address,
  Chain,
  encodeFunctionData,
  ParseAccount,
  PublicClient,
  RpcSchema,
  Transport,
  WalletClient,
} from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { MINT_VEHICLE_WITH_DEVICE_DEFINITION } from ":core/constants/methods.js";
import { MintVehicleWithDeviceDefinition } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export function mintVehicleCallData(
  args: MintVehicleWithDeviceDefinition,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
    args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo],
  });
}

export const mintVehicleWithDeviceDefinition = async (
  args: MintVehicleWithDeviceDefinition,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_REGISTRY].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_REGISTRY].abi,
        functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
        args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo],
      }),
    },
  ]);
};

export const mintVehicleWithDeviceDefinitionBatch = async (
  args: MintVehicleWithDeviceDefinition[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  const callData = args.map((arg) => {
    return {
      to: contracts[ContractType.DIMO_REGISTRY].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_REGISTRY].abi,
        functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
        args: [arg.manufacturerNode, arg.owner, arg.deviceDefinitionID, arg.attributeInfo],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
};

export const mintVehicleWithDeviceDefinitionFromAccount = async (
  args: MintVehicleWithDeviceDefinition,
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;

  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_REGISTRY].address,
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
    args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
};
