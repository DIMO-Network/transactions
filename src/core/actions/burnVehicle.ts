import { KernelAccountClient } from "@zerodev/sdk";
import { encodeFunctionData } from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { BURN_VEHICLE } from ":core/constants/methods.js";
import { BurnVehicle } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export function burnVehicleCallData(args: BurnVehicle, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
    functionName: BURN_VEHICLE,
    args: [args.tokenId],
  });
}

export async function burnVehicle(
  args: BurnVehicle,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_VEHICLE_ID].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
        functionName: BURN_VEHICLE,
        args: [args.tokenId],
      }),
    },
  ]);
}

export async function burnVehicleBatch(
  args: BurnVehicle[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const callData = args.map((arg) => {
    return {
      to: contracts[ContractType.DIMO_VEHICLE_ID].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
        functionName: BURN_VEHICLE,
        args: [arg.tokenId],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}

// Burn Vehicle-- cant burn if you still have AD attached
// 0xc46a516800000000000000000000000000000000000000000000000000000000000000f6
