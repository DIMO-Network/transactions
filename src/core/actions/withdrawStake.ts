import { KernelAccountClient } from "@zerodev/sdk";
import { encodeFunctionData } from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { WithdrawStake } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export async function withdrawStake(
  args: WithdrawStake,
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
        functionName: "withdraw",
        args: [args.stakeId],
      }),
    },
  ]);
}
