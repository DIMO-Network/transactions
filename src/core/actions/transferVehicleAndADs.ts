import { KernelAccountClient } from "@zerodev/sdk";
import { ethers } from "ethers";
import {
  Account,
  Address,
  Chain,
  encodeFunctionData,
  ParseAccount,
  PublicClient,
  RpcSchema,
  TransactionRequest,
  Transport,
  WalletClient,
} from "viem";
import { polygon } from "viem/chains";

import { DIMODomain, DIMODomainVersion } from ":core/constants/dimo.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { TRANSFER_VEHICLE_AND_AFTERMARKET_DEVICE_IDS } from ":core/constants/methods.js";
import { TransferVehicleAndAftermarketDeviceIDs } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export function transferVehicleAndAftermarketDeviceIDsCallData(
  args: TransferVehicleAndAftermarketDeviceIDs,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_FORWARDER].abi,
    functionName: TRANSFER_VEHICLE_AND_AFTERMARKET_DEVICE_IDS,
    args: [args.vehicleIds, args.aftermarketDeviceIds, args.to],
  });
}

export const transferVehicleAndAftermarketDeviceIDs = async (
  args: TransferVehicleAndAftermarketDeviceIDs,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_FORWARDER].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_FORWARDER].abi,
        functionName: TRANSFER_VEHICLE_AND_AFTERMARKET_DEVICE_IDS,
        args: [args.vehicleIds, args.aftermarketDeviceIds, args.to],
      }),
    },
  ]);
};

export async function transferVehicleAndAftermarketDeviceIDsFromAccount(
  args: TransferVehicleAndAftermarketDeviceIDs,
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.DEV].contracts;
  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_FORWARDER].address,
    abi: contracts[ContractType.DIMO_FORWARDER].abi,
    functionName: TRANSFER_VEHICLE_AND_AFTERMARKET_DEVICE_IDS,
    args: [args.vehicleIds, args.aftermarketDeviceIds, args.to],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}

export async function transferVehiclesAndAftermarketDevicesForSignature(
  args: TransferVehicleAndAftermarketDeviceIDs,
  publicClient: PublicClient,
  walletClient: WalletClient,
  senderAddress: `0x${string}`,
  environment: string = "prod"
): Promise<TransactionRequest> {
  const chain = ENV_NETWORK_MAPPING.get(ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD) ?? polygon;
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const gas = await publicClient.estimateFeesPerGas();
  const gaslimit = await publicClient.getGasPrice();
  const gasPrice = await publicClient.estimateContractGas({
    address: contracts[ContractType.DIMO_FORWARDER].address,
    abi: contracts[ContractType.DIMO_FORWARDER].abi,
    functionName: TRANSFER_VEHICLE_AND_AFTERMARKET_DEVICE_IDS,
    args: [args.vehicleIds, args.aftermarketDeviceIds, args.to],
    account: senderAddress,
  });
  const callData = transferVehicleAndAftermarketDeviceIDsCallData(args, environment);
  const nonce = await publicClient.getTransactionCount({ address: senderAddress });
  const preparedTransaction = await walletClient.prepareTransactionRequest({
    to: contracts[ContractType.DIMO_FORWARDER].address,
    nonce: nonce,
    data: callData,
    gas: gasPrice,
    gasLimit: gaslimit,
    maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    maxFeePerGas: gas.maxFeePerGas,
    chain: chain,
  });

  return preparedTransaction as TransactionRequest;
}

export const transferAllTypeHash = (
  args: TransferVehicleAndAftermarketDeviceIDs,
  environment: string = "prod"
): {
  hash: string;
  payload: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: {
      TransferVehicleAndAftermarketDeviceIds: {
        name: string;
        type: string;
      }[];
    };
    message: {
      vehicleIds: bigint[];
      aftermarketDeviceIds: bigint[];
      to: `0x${string}`;
    };
  };
} => {
  const env = ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD;
  const chain = ENV_NETWORK_MAPPING.get(env) ?? polygon;
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const domain = {
    name: DIMODomain,
    version: DIMODomainVersion,
    chainId: chain.id,
    verifyingContract: contracts[ContractType.DIMO_REGISTRY].address,
  };

  const types = {
    ["TransferVehicleAndAftermarketDeviceIds"]: [
      { name: "vehicleIds", type: "uint256[]" },
      { name: "aftermarketDeviceIds", type: "uint256[]" },
      { name: "to", type: "address" },
    ],
  };

  const message = {
    vehicleIds: args.vehicleIds,
    aftermarketDeviceIds: args.aftermarketDeviceIds,
    to: args.to,
  };

  const hash = ethers.TypedDataEncoder.hash(domain, types, message);

  return { hash, payload: { domain, types, message } };
};
