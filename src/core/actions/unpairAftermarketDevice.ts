import { KernelAccountClient } from "@zerodev/sdk";
import { encodeFunctionData } from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { UNPAIR_AFTERMARKET_DEVICE } from ":core/constants/methods.js";
import { UnPairAftermarketDevice } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export function unpairAftermarketDeviceCallData(
  args: UnPairAftermarketDevice,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_REGISTRY].abi,
    functionName: UNPAIR_AFTERMARKET_DEVICE,
    args: [args.aftermarketDeviceNode, args.vehicleNode],
  });
}

export const unpairAftermarketDevice = async (
  args: UnPairAftermarketDevice,
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
        functionName: UNPAIR_AFTERMARKET_DEVICE,
        args: [args.aftermarketDeviceNode, args.vehicleNode],
      }),
    },
  ]);
};
