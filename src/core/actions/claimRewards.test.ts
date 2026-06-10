import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData, zeroAddress } from "viem";
import { KernelAccountClient } from "@zerodev/sdk";
import {
  assertMerkleDistributorAddress,
  claimRewards,
  claimRewardsBatch,
  claimRewardsCallData,
  claimRewardsBatchCallData,
} from "./claimRewards.js";
import { abiMerkleDistributor } from "../abis/MerkleDistributor.js";
import { CLAIM_REWARDS, CLAIM_REWARDS_BATCH } from "../constants/methods.js";
import { ClaimRewards, ClaimRewardsBatch } from "../types/args.js";

const { prodDistributorAddress, devDistributorAddress } = vi.hoisted(() => ({
  prodDistributorAddress: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  devDistributorAddress: "0x2222222222222222222222222222222222222222" as `0x${string}`,
}));

// Module-level mock (no mutation of the CHAIN_ABI_MAPPING singleton): prod and dev get
// distinct configured addresses; prod_test is left untouched with its zeroAddress placeholder.
vi.mock("../constants/mappings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../constants/mappings.js")>();
  const { ContractType, ENVIRONMENT } = await import("../types/dimo.js");

  const withDistributorAddress = (env: (typeof ENVIRONMENT)[keyof typeof ENVIRONMENT], address: `0x${string}`) => ({
    ...actual.CHAIN_ABI_MAPPING[env],
    contracts: {
      ...actual.CHAIN_ABI_MAPPING[env].contracts,
      [ContractType.DIMO_MERKLE_DISTRIBUTOR]: {
        ...actual.CHAIN_ABI_MAPPING[env].contracts[ContractType.DIMO_MERKLE_DISTRIBUTOR],
        address,
      },
    },
  });

  return {
    ...actual,
    CHAIN_ABI_MAPPING: {
      ...actual.CHAIN_ABI_MAPPING,
      [ENVIRONMENT.PROD]: withDistributorAddress(ENVIRONMENT.PROD, prodDistributorAddress),
      [ENVIRONMENT.DEV]: withDistributorAddress(ENVIRONMENT.DEV, devDistributorAddress),
    },
  };
});

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

  it("produces identical call data across configured environments", () => {
    // dev and prod are mocked with different distributor addresses, proving the address never leaks into call data.
    expect(claimRewardsCallData(args, "dev")).toBe(claimRewardsCallData(args, "prod"));
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

  it("produces identical call data across configured environments", () => {
    expect(claimRewardsBatchCallData(args, "dev")).toBe(claimRewardsBatchCallData(args, "prod"));
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

  const notConfiguredError = "MerkleDistributor address not configured for this environment";

  // prod_test ships with a zeroAddress placeholder, so these run against the real mapping untouched.
  it("claimRewards throws when the MerkleDistributor address is the zero address", async () => {
    await expect(claimRewards(claimArgs, mockClient, "prod_test")).rejects.toThrow(notConfiguredError);
  });

  it("claimRewardsBatch throws when the MerkleDistributor address is the zero address", async () => {
    await expect(claimRewardsBatch(batchArgs, mockClient, "prod_test")).rejects.toThrow(notConfiguredError);
  });

  it("claimRewardsCallData throws when the MerkleDistributor address is the zero address", () => {
    expect(() => claimRewardsCallData(claimArgs, "prod_test")).toThrow(notConfiguredError);
  });

  it("claimRewardsBatchCallData throws when the MerkleDistributor address is the zero address", () => {
    expect(() => claimRewardsBatchCallData(batchArgs, "prod_test")).toThrow(notConfiguredError);
  });

  it("claimRewards does not throw for an environment with a configured address", async () => {
    await expect(claimRewards(claimArgs, mockClient, "prod")).resolves.toBe("0xencoded");
  });

  it("claimRewardsBatch does not throw for an environment with a configured address", async () => {
    await expect(claimRewardsBatch(batchArgs, mockClient, "prod")).resolves.toBe("0xencoded");
  });
});

describe("assertMerkleDistributorAddress", () => {
  it("returns the address when it is configured", () => {
    expect(assertMerkleDistributorAddress(account)).toBe(account);
  });

  it("throws when the address is the zero address", () => {
    expect(() => assertMerkleDistributorAddress(zeroAddress)).toThrow(
      "MerkleDistributor address not configured for this environment"
    );
  });
});
