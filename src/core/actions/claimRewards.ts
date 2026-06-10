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
  zeroAddress,
} from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { CLAIM_REWARDS, CLAIM_REWARDS_BATCH } from ":core/constants/methods.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ClaimRewards, ClaimRewardsBatch } from ":core/types/args.js";

function assertMerkleDistributorAddress(address: Address): Address {
  if (address === zeroAddress) {
    throw new Error("MerkleDistributor address not configured for this environment");
  }
  return address;
}

/**
 * Encodes call data for a single-week MerkleDistributor reward claim.
 *
 * @param args.poolId - Reward pool identifier.
 * @param args.week - Week index being claimed.
 * @param args.account - Account the rewards were proven for (the only account that can be paid).
 * @param args.amount - Reward amount for the week.
 * @param args.proof - Merkle proof for (week, account, amount).
 * @param environment - Target environment ("prod" by default).
 * @returns ABI-encoded `claim` call data.
 */
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
      to: assertMerkleDistributorAddress(contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address),
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
    address: assertMerkleDistributorAddress(contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address),
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS,
    args: [args.poolId, args.week, args.account, args.amount, args.proof],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}

/**
 * Encodes call data for a multi-week MerkleDistributor reward claim.
 *
 * @param args.poolId - Reward pool identifier.
 * @param args.weeks - Week indexes being claimed.
 * @param args.account - Account the rewards were proven for (the only account that can be paid).
 * @param args.amounts - Reward amounts, aligned by index with `weeks`.
 * @param args.proofs - Array of Merkle proof arrays, one proof array per entry in `weeks` (aligned by index).
 * @param environment - Target environment ("prod" by default).
 * @returns ABI-encoded `claimBatch` call data.
 */
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
      to: assertMerkleDistributorAddress(contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address),
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
    address: assertMerkleDistributorAddress(contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].address),
    abi: contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR].abi,
    functionName: CLAIM_REWARDS_BATCH,
    args: [args.poolId, args.weeks, args.account, args.amounts, args.proofs],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}
