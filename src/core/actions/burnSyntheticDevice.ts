import { encodeFunctionData } from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { BURN_SYNTHETIC_DEVICE } from ":core/constants/methods.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { BurnSyntheticDevice } from ":core/types/args.js";

export function burnSyntheticDeviceCallData(args: BurnSyntheticDevice, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SYNTHETIC_DEVICE_ID].abi,
    functionName: BURN_SYNTHETIC_DEVICE,
    args: [args.tokenId],
  });
}

export async function burnSyntheticDevice(
  args: BurnSyntheticDevice,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SYNTHETIC_DEVICE_ID].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SYNTHETIC_DEVICE_ID].abi,
        functionName: BURN_SYNTHETIC_DEVICE,
        args: [args.tokenId],
      }),
    },
  ]);
}

export async function burnSyntheticDeviceBatch(
  args: BurnSyntheticDevice[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const callData = args.map((arg) => ({
    to: contracts[ContractType.DIMO_SYNTHETIC_DEVICE_ID].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_SYNTHETIC_DEVICE_ID].abi,
      functionName: BURN_SYNTHETIC_DEVICE,
      args: [arg.tokenId],
    }),
  }));

  return await client.account!.encodeCalls(callData);
}
