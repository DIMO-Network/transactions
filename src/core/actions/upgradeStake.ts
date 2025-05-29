import { UpgradeStake } from ":core/types/args.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { encodeFunctionData, parseEther } from "viem";

export async function upgradeStake(
  args: UpgradeStake,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_TOKEN].address,
      value: BigInt("0"),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_TOKEN].abi,
        functionName: "approve",
        args: [contracts[ContractType.DIMO_STAKING].address, BigInt(parseEther(args.amountDiff.toString()))],
      }),
    },
    {
      to: contracts[ContractType.DIMO_STAKING].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_STAKING].abi,
        functionName: "upgradeStake",
        args: [args.stakeId, args.level, args.vehicleId],
      }),
    },
  ]);
}
