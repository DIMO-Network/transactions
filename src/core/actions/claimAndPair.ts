import { encodeFunctionData } from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CLAIM_AFTERMARKET_DEVICE, PAIR_AFTERMARKET_DEVICE } from ":core/constants/methods.js";
import { ClaimAftermarketDevice, PairAftermarketDevice } from ":core/types/args.js";

export const claimAndPairDevice = async (
  args: ClaimAftermarketDevice & PairAftermarketDevice,
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
        functionName: CLAIM_AFTERMARKET_DEVICE,
        args: [args.aftermarketDeviceNode, args.aftermarketDeviceSig],
      }),
    },
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
