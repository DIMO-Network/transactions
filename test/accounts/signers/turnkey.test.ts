import { describe, expect, it, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { TurnkeyClient } from "@turnkey/http";
import {
  didKeyFromCompressed,
  ethAddressFromDidKey,
  verifyOpSignature,
} from "../../../src/accounts/core/index.js";
import {
  TurnkeyWalletSigner,
  turnkeyWalletDidKey,
} from "../../../src/accounts/signers/turnkey.js";

type SignArg = {
  type: string;
  organizationId: string;
  parameters: Record<string, string>;
};
const priv = secp256k1.utils.randomSecretKey();
const compressed = secp256k1.getPublicKey(priv, true);
const uncompressed = secp256k1.getPublicKey(priv, false);
const didKey = didKeyFromCompressed("secp256k1", compressed);
const walletAddress = ethAddressFromDidKey(didKey) as `0x${string}`;
const payload = new TextEncoder().encode('{"hello":"world"}');

function rsFor(msg: Uint8Array, key = priv) {
  const sig = secp256k1.sign(sha256(msg), key, {
    prehash: false,
    format: "compact",
  });
  return { r: bytesToHex(sig.slice(0, 32)), s: bytesToHex(sig.slice(32)) };
}

function mockClient(rs: { r: string; s: string }) {
  const signRawPayload = vi.fn(async () => ({
    activity: {
      id: "a",
      status: "ACTIVITY_STATUS_COMPLETED",
      result: { signRawPayloadResult: rs },
    },
  }));
  return {
    signRawPayload,
    client: { signRawPayload } as unknown as TurnkeyClient,
  };
}

describe("TurnkeyWalletSigner", () => {
  it("sends the sha256-text mode by default", async () => {
    const { client, signRawPayload } = mockClient(rsFor(payload));
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
    });
    await signer.sign(payload);
    const arg = (signRawPayload.mock.calls[0] as unknown[])[0] as SignArg;
    expect(arg.type).toBe("ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2");
    expect(arg.organizationId).toBe("org");
    expect(arg.parameters.signWith).toBe(walletAddress);
    expect(arg.parameters.encoding).toBe("PAYLOAD_ENCODING_TEXT_UTF8");
    expect(arg.parameters.hashFunction).toBe("HASH_FUNCTION_SHA256");
    expect(arg.parameters.payload).toBe('{"hello":"world"}');
  });

  it("sends the noop-digest mode when asked", async () => {
    const { client, signRawPayload } = mockClient(rsFor(payload));
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
      mode: "noop-digest",
    });
    await signer.sign(payload);
    const arg = (signRawPayload.mock.calls[0] as unknown[])[0] as SignArg;
    expect(arg.parameters.encoding).toBe("PAYLOAD_ENCODING_HEXADECIMAL");
    expect(arg.parameters.hashFunction).toBe("HASH_FUNCTION_NO_OP");
    expect(arg.parameters.payload).toBe(bytesToHex(sha256(payload)));
  });

  it("converts r/s and self-verifies", async () => {
    const { client } = mockClient(rsFor(payload));
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
    });
    const sig = await signer.sign(payload);
    expect(verifyOpSignature(payload, sig, didKey)).toBe(true);
  });

  it("throws if Turnkey's signature does not verify", async () => {
    const other = secp256k1.utils.randomSecretKey();
    const { client } = mockClient(rsFor(payload, other));
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
    });
    await expect(signer.sign(payload)).rejects.toThrow(/verif/i);
  });

  it("throws if the activity has no signature result", async () => {
    const client = {
      signRawPayload: vi.fn(async () => ({
        activity: { id: "a", status: "ACTIVITY_STATUS_COMPLETED", result: {} },
      })),
    } as unknown as TurnkeyClient;
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
    });
    await expect(signer.sign(payload)).rejects.toThrow();
  });
});

function accountsClient(accounts: unknown[]) {
  return {
    getWalletAccounts: vi.fn(async () => ({ accounts })),
  } as unknown as TurnkeyClient;
}

describe("turnkeyWalletDidKey", () => {
  it("uses the ETH account uncompressed publicKey", async () => {
    const client = accountsClient([
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        address: walletAddress,
        publicKey: bytesToHex(uncompressed),
      },
    ]);
    expect(await turnkeyWalletDidKey(client, "org", walletAddress)).toBe(
      didKey,
    );
  });

  it("uses a compressed ETH publicKey", async () => {
    const client = accountsClient([
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        address: walletAddress,
        publicKey: bytesToHex(compressed),
      },
    ]);
    expect(
      await turnkeyWalletDidKey(
        client,
        "org",
        walletAddress.toLowerCase() as `0x${string}`,
      ),
    ).toBe(didKey);
  });

  it("falls back to the compressed account", async () => {
    const client = accountsClient([
      { addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: walletAddress },
      {
        addressFormat: "ADDRESS_FORMAT_COMPRESSED",
        address: bytesToHex(compressed),
        path: "m/44'/60'/0'/0/0",
      },
    ]);
    expect(await turnkeyWalletDidKey(client, "org", walletAddress)).toBe(
      didKey,
    );
  });

  it("ignores compressed accounts on other paths", async () => {
    const client = accountsClient([
      { addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: walletAddress },
      {
        addressFormat: "ADDRESS_FORMAT_COMPRESSED",
        address: bytesToHex(compressed),
        path: "m/44'/60'/0'/0/1",
      },
    ]);
    await expect(
      turnkeyWalletDidKey(client, "org", walletAddress),
    ).rejects.toThrow(/compressed/i);
  });

  it("throws when no public key is available", async () => {
    const client = accountsClient([
      { addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: walletAddress },
    ]);
    await expect(
      turnkeyWalletDidKey(client, "org", walletAddress),
    ).rejects.toThrow(/compressed/i);
  });

  it("throws when the key does not match the wallet address", async () => {
    const other = secp256k1.getPublicKey(
      secp256k1.utils.randomSecretKey(),
      true,
    );
    const client = accountsClient([
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        address: walletAddress,
        publicKey: bytesToHex(other),
      },
    ]);
    await expect(
      turnkeyWalletDidKey(client, "org", walletAddress),
    ).rejects.toThrow(/match/i);
  });

  it("skips another wallets compressed account that comes first", async () => {
    const otherPub = secp256k1.getPublicKey(
      secp256k1.utils.randomSecretKey(),
      true,
    );
    const client = accountsClient([
      {
        addressFormat: "ADDRESS_FORMAT_COMPRESSED",
        address: bytesToHex(otherPub),
        path: "m/44'/60'/0'/0/0",
      },
      { addressFormat: "ADDRESS_FORMAT_ETHEREUM", address: walletAddress },
      {
        addressFormat: "ADDRESS_FORMAT_COMPRESSED",
        address: bytesToHex(compressed),
        path: "m/44'/60'/0'/0/0",
      },
    ]);
    expect(await turnkeyWalletDidKey(client, "org", walletAddress)).toBe(
      didKey,
    );
  });

  it("passes walletId through when given", async () => {
    const client = accountsClient([
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        address: walletAddress,
        publicKey: bytesToHex(uncompressed),
      },
    ]);
    await turnkeyWalletDidKey(client, "org", walletAddress, { walletId: "w1" });
    expect(client.getWalletAccounts).toHaveBeenCalledWith({
      organizationId: "org",
      walletId: "w1",
    });
    await turnkeyWalletDidKey(client, "org", walletAddress);
    expect(client.getWalletAccounts).toHaveBeenLastCalledWith({
      organizationId: "org",
    });
  });
});

describe("TurnkeyWalletSigner sha256-text mode", () => {
  it("throws on a non-UTF-8 payload", async () => {
    const { client } = mockClient(rsFor(payload));
    const signer = new TurnkeyWalletSigner({
      client,
      organizationId: "org",
      walletAddress,
      didKey,
    });
    await expect(
      signer.sign(new Uint8Array([0xff, 0xfe, 0x00])),
    ).rejects.toThrow();
  });
});
