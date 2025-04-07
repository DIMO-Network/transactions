import { DetachVehicle } from ":core/types/args.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { encodeFunctionData } from "viem";

export async function detachVehicle(
  args: DetachVehicle,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_STAKING].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_STAKING].abi,
        functionName: 'detachVehicle',
        args: [args.vehicleId],
      }),
    },
  ]);
}
