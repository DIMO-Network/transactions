import { KernelAccountClient } from "@zerodev/sdk";
import { encodeFunctionData, hashTypedData } from "viem";
import { polygon } from "viem/chains";

import {
  AftermarketDeviceNode,
  DIMODomain,
  DIMODomainVersion,
  PairAftermarketDeviceSign,
  SolidityTypeUint256,
  VehicleNode,
} from ":core/constants/dimo.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { PAIR_AFTERMARKET_DEVICE, PAIR_AFTERMARKET_DEVICE_WITH_AD_SIG } from ":core/constants/methods.js";
import { PairAftermarketDevice, PairAftermarketDeviceWithAdSig } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { TypeHashResponse } from ":core/types/responses.js";

export const pairAftermarketDeviceTypeHash = (
  aftermarketDeviceNode: bigint,
  vehicleNode: bigint,
  environment: string = "prod"
): TypeHashResponse => {
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
    [PairAftermarketDeviceSign]: [
      { name: AftermarketDeviceNode, type: SolidityTypeUint256 },
      { name: VehicleNode, type: SolidityTypeUint256 },
    ],
  };

  const message = {
    aftermarketDeviceNode: aftermarketDeviceNode,
    vehicleNode: vehicleNode,
  };

  const hash = hashTypedData({
    domain,
    types,
    primaryType: PairAftermarketDeviceSign,
    message,
  });

  return { hash, payload: { domain, types, message } };
};

export function pairAftermarketDeviceCallData(
  args: PairAftermarketDevice,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: PAIR_AFTERMARKET_DEVICE,
    args: [args.aftermarketDeviceNode, args.vehicleNode],
  });
}

export const pairAftermarketDevice = async (
  args: PairAftermarketDevice,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_REGISTRY].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_REGISTRY].abi,
        functionName: PAIR_AFTERMARKET_DEVICE,
        args: [args.aftermarketDeviceNode, args.vehicleNode],
      }),
    },
  ]);
};

export function pairAftermarketDeviceWithAdSigCallData(
  args: PairAftermarketDeviceWithAdSig,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: PAIR_AFTERMARKET_DEVICE_WITH_AD_SIG,
    args: [args.aftermarketDeviceNode, args.vehicleNode, args.aftermarketDeviceSig],
  });
}

export const pairAftermarketDeviceWithAdSig = async (
  args: PairAftermarketDeviceWithAdSig,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> => {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_REGISTRY].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_REGISTRY].abi,
        functionName: PAIR_AFTERMARKET_DEVICE_WITH_AD_SIG,
        args: [args.aftermarketDeviceNode, args.vehicleNode, args.aftermarketDeviceSig],
      }),
    },
  ]);
};
