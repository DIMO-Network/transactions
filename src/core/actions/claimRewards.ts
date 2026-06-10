import {
  Account,
  Address,
  Chain,
  ParseAccount,
  PublicClient,
  RpcSchema,
  Transport,
  WalletClient,
  encodeFunctionData,
} from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { CLAIM_REWARDS, CLAIM_REWARDS_BATCH } from ":core/constants/methods.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ClaimRewards, ClaimRewardsBatch } from ":core/types/args.js";

export function claimRewardsCallData(args: ClaimRewards, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS,
    args: [args.poolId, args.week, args.account, args.amount, args.proof],
  });
}

export async function claimRewards(
  args: ClaimRewards,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
        functionName: CLAIM_REWARDS,
        args: [args.poolId, args.week, args.account, args.amount, args.proof],
      }),
    },
  ]);
}

export async function claimRewardsFromAccount(
  args: ClaimRewards,
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address,
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS,
    args: [args.poolId, args.week, args.account, args.amount, args.proof],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}

export function claimRewardsBatchCallData(args: ClaimRewardsBatch, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS_BATCH,
    args: [args.poolId, args.weeks, args.account, args.amounts, args.proofs],
  });
}

export async function claimRewardsBatch(
  args: ClaimRewardsBatch,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
        functionName: CLAIM_REWARDS_BATCH,
        args: [args.poolId, args.weeks, args.account, args.amounts, args.proofs],
      }),
    },
  ]);
}

export async function claimRewardsBatchFromAccount(
  args: ClaimRewardsBatch,
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address,
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS_BATCH,
    args: [args.poolId, args.weeks, args.account, args.amounts, args.proofs],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}
