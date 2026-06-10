import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import { claimRewardsCallData, claimRewardsBatchCallData } from "./claimRewards.js";
import { abiMerkleDistributor } from "../abis/MerkleDistributor.js";
import { CLAIM_REWARDS, CLAIM_REWARDS_BATCH } from "../constants/methods.js";
import { ClaimRewards, ClaimRewardsBatch } from "../types/args.js";

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
