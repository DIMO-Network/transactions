import { KernelAccountClient } from "@zerodev/sdk";
import { encodeFunctionData, parseEther } from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { AddStake } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export async function addStake(
  args: AddStake,
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
        args: [contracts[ContractType.DIMO_STAKING].address, BigInt(parseEther(args.amount.toString()))],
      }),
    },
    {
      to: contracts[ContractType.DIMO_STAKING].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_STAKING].abi,
        functionName: "stake",
        args: [args.level, args.tokenId],
      }),
    },
  ]);
}
