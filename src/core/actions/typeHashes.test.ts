import { describe, expect, it } from "vitest";

import { pairAftermarketDeviceTypeHash } from ":core/actions/pairAftermarketDevice.js";
import { claimAftermarketDeviceTypeHash } from ":core/actions/claimAftermarketDevice.js";
import { transferAllTypeHash } from ":core/actions/transferVehicleAndADs.js";

// Expected values were produced by ethers v6 `TypedDataEncoder.hash` before the switch to viem
// `hashTypedData`. Contracts verify these EIP-712 digests on-chain, so they must never change.
const EXPECTED = {
  prod: {
    pair: "0x3cc6068b284bb5009ec0d27a4036c04bbfa2cfaf43a6430f69b24fc2164d1fa2",
    claim: "0xbe23225bbe6c22c714036bbb9106f2a080c6d703a4ad584e57b1ab2073698506",
    transfer: "0xa081464f65658f8597d973b162b93394a3bae232127416c389d415ca125ad7a0",
  },
  dev: {
    pair: "0x5d0d6a2b2805d3e485749bf225576a839a9207afb0ddd8055b8c4eae3e9cce6d",
    claim: "0x89701233a49fccdf1f7de8755b39f85d52f29c83a9800f36fb051eb345a1db6d",
    transfer: "0xada0f9a714f4bd070d0292cf973a3a90f98520d8e819b7cf3f46ae31a1eb4df6",
  },
} as const;

describe.each(["prod", "dev"] as const)("EIP-712 type hashes (%s)", (env) => {
  it("pairAftermarketDeviceTypeHash", () => {
    expect(pairAftermarketDeviceTypeHash(BigInt(123), BigInt(456), env).hash).toBe(EXPECTED[env].pair);
  });

  it("claimAftermarketDeviceTypeHash", () => {
    expect(claimAftermarketDeviceTypeHash(BigInt(789),"0x1111111111111111111111111111111111111111", env).hash).toBe(
      EXPECTED[env].claim
    );
  });

  it("transferAllTypeHash", () => {
    const args = {
      vehicleIds: [BigInt(1), BigInt(2)],
      aftermarketDeviceIds: [BigInt(3)],
      to: "0x2222222222222222222222222222222222222222",
    } as Parameters<typeof transferAllTypeHash>[0];
    expect(transferAllTypeHash(args, env).hash).toBe(EXPECTED[env].transfer);
  });
});
