import {
  Account,
  Address,
  Chain,
  ParseAccount,
  PublicClient,
  RpcSchema,
  Transport,
  WalletClient,
  encodeFunctionData,
} from "viem";
import { ContractType, ENVIRONMENT, KernelConfig } from ":core/types/dimo.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { KernelAccountClient, KernelSmartAccount } from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { MINT_VEHICLE_WITH_DEVICE_DEFINITION } from ":core/constants/methods.js";
import { MintVehicleWithDeviceDefinition } from ":core/types/args.js";
import { GetUserOperationReceiptReturnType } from "permissionless";
import { KernelEncodeCallDataArgs } from "@zerodev/sdk/types";
import { executeTransaction } from ":core/transactions/execute.js";

export function mintVehicleCallData(
  args: MintVehicleWithDeviceDefinition,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
    args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo, args.sacdInput],
  });
}

export const mintVehicleTransaction = async (
  args: MintVehicleWithDeviceDefinition,
  subOrganizationId: string,
  walletAddress: string,
  passkeyStamper: any,
  config: KernelConfig
): Promise<GetUserOperationReceiptReturnType> => {
  const env = ENV_MAPPING.get(config.environment ?? "prod") ?? ENVIRONMENT.PROD;
  const contracts = CHAIN_ABI_MAPPING[env].contracts;

  const mintCallData = mintVehicleCallData(args, config.environment);

  const txData: KernelEncodeCallDataArgs = {
    callType: "call",
    to: contracts[ContractType.DIMO_REGISTRY].address,
    value: BigInt("0"),
    data: mintCallData,
  };

  const resp = await executeTransaction(subOrganizationId, walletAddress, txData, passkeyStamper, config);

  return resp;
};

export const mintVehicleWithDeviceDefinition = async (
  args: MintVehicleWithDeviceDefinition,
  client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return await client.account.encodeCallData({
    to: contracts[ContractType.DIMO_REGISTRY].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_REGISTRY].abi,
      functionName: MINT_VEHICLE_WITH_DEVICE_DEFINITION,
      args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo, args.sacdInput],
    }),
  });
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
    args: [args.manufacturerNode, args.owner, args.deviceDefinitionID, args.attributeInfo, args.sacdInput],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
};
