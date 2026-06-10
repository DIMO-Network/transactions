import { describe, it, expect, afterEach } from "vitest";
import { decodeFunctionData, zeroAddress } from "viem";
import { KernelAccountClient } from "@zerodev/sdk";
import { claimRewards, claimRewardsBatch, claimRewardsCallData, claimRewardsBatchCallData } from "./claimRewards.js";
import { abiMerkleDistributor } from "../abis/MerkleDistributor.js";
import { CLAIM_REWARDS, CLAIM_REWARDS_BATCH } from "../constants/methods.js";
import { CHAIN_ABI_MAPPING } from "../constants/mappings.js";
import { ClaimRewards, ClaimRewardsBatch } from "../types/args.js";
import { ContractType, ENVIRONMENT } from "../types/dimo.js";

const account = "0x1234567890123456789012345678901234567890" as `0x${string}`;
const proofA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const proofB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
const proofC = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as `0x${string}`;

describe("claimRewardsCallData", () => {
  const args: ClaimRewards = {
    poolId: BigInt(0),
    week: BigInt(42),
    account: account,
    amount: BigInt("1000000000000000000"),
    proof: [proofA, proofB],
  };

  it("encodes claim call data that decodes back to the same args", () => {
    const callData = claimRewardsCallData(args, "prod");

    const decoded = decodeFunctionData({
      abi: abiMerkleDistributor,
      data: callData,
    });

    expect(decoded.functionName).toBe(CLAIM_REWARDS);
    expect(decoded.args).toEqual([args.poolId, args.week, args.account, args.amount, args.proof]);
  });

  it("produces identical call data across environments", () => {
    expect(claimRewardsCallData(args, "dev")).toBe(claimRewardsCallData(args, "prod"));
    expect(claimRewardsCallData(args, "prod_test")).toBe(claimRewardsCallData(args, "prod"));
  });

  it("encodes an empty proof array", () => {
    const callData = claimRewardsCallData({ ...args, proof: [] }, "prod");

    const decoded = decodeFunctionData({
      abi: abiMerkleDistributor,
      data: callData,
    });

    expect(decoded.functionName).toBe(CLAIM_REWARDS);
    expect(decoded.args).toEqual([args.poolId, args.week, args.account, args.amount, []]);
  });
});

describe("claimRewardsBatchCallData", () => {
  const args: ClaimRewardsBatch = {
    poolId: BigInt(1),
    weeks: [BigInt(10), BigInt(11)],
    account: account,
    amounts: [BigInt("1000000000000000000"), BigInt("2500000000000000000")],
    proofs: [[proofA, proofB], [proofC]],
  };

  it("encodes claimBatch call data that decodes back to the same args", () => {
    const callData = claimRewardsBatchCallData(args, "prod");

    const decoded = decodeFunctionData({
      abi: abiMerkleDistributor,
      data: callData,
    });

    expect(decoded.functionName).toBe(CLAIM_REWARDS_BATCH);
    expect(decoded.args).toEqual([args.poolId, args.weeks, args.account, args.amounts, args.proofs]);
  });

  it("produces identical call data across environments", () => {
    expect(claimRewardsBatchCallData(args, "dev")).toBe(claimRewardsBatchCallData(args, "prod"));
    expect(claimRewardsBatchCallData(args, "prod_test")).toBe(claimRewardsBatchCallData(args, "prod"));
  });
});

describe("zero-address guard", () => {
  const claimArgs: ClaimRewards = {
    poolId: BigInt(0),
    week: BigInt(42),
    account: account,
    amount: BigInt("1000000000000000000"),
    proof: [proofA, proofB],
  };

  const batchArgs: ClaimRewardsBatch = {
    poolId: BigInt(1),
    weeks: [BigInt(10), BigInt(11)],
    account: account,
    amounts: [BigInt("1000000000000000000"), BigInt("2500000000000000000")],
    proofs: [[proofA, proofB], [proofC]],
  };

  const mockClient = {
    account: {
      encodeCalls: async () => "0xencoded" as `0x${string}`,
    },
  } as unknown as KernelAccountClient;

  const prodTestDistributor = CHAIN_ABI_MAPPING[ENVIRONMENT.PROD_TEST].contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR];
  const originalProdTestAddress = prodTestDistributor.address;

  afterEach(() => {
    prodTestDistributor.address = originalProdTestAddress;
  });

  // prod_test keeps a zeroAddress placeholder, so these stay green once real prod/dev addresses land.
  it("claimRewards throws when the MerkleDistributor address is the zero address", async () => {
    prodTestDistributor.address = zeroAddress;
    await expect(claimRewards(claimArgs, mockClient, "prod_test")).rejects.toThrow(
      "MerkleDistributor address not configured for this environment"
    );
  });

  it("claimRewardsBatch throws when the MerkleDistributor address is the zero address", async () => {
    prodTestDistributor.address = zeroAddress;
    await expect(claimRewardsBatch(batchArgs, mockClient, "prod_test")).rejects.toThrow(
      "MerkleDistributor address not configured for this environment"
    );
  });

  it("claimRewards does not throw once a real address is configured", async () => {
    prodTestDistributor.address = "0x1111111111111111111111111111111111111111";
    await expect(claimRewards(claimArgs, mockClient, "prod_test")).resolves.toBe("0xencoded");
  });

  it("claimRewardsBatch does not throw once a real address is configured", async () => {
    prodTestDistributor.address = "0x1111111111111111111111111111111111111111";
    await expect(claimRewardsBatch(batchArgs, mockClient, "prod_test")).resolves.toBe("0xencoded");
  });
});
