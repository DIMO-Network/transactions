import { createActivityPoller, type TurnkeyClient } from "@turnkey/http";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  didKeyFromCompressed,
  EncodingError,
  ethAddressFromDidKey,
  rsToSig,
  verifyOpSignature,
} from "../core/index.js";
import { TurnkeyError } from "../errors.js";
import type { Signer } from "./types.js";

/**
 * 'sha256-text': Turnkey hashes the UTF-8 payload with SHA-256 itself.
 * 'noop-digest': the SDK hashes and sends the hex digest with no further hashing.
 */
export type TurnkeySignMode = "sha256-text" | "noop-digest";

export interface TurnkeyWalletSignerOptions {
  client: TurnkeyClient;
  organizationId: string;
  walletAddress: `0x${string}`;
  didKey: string;
  mode?: TurnkeySignMode;
}

function utf8(payload: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch (cause) {
    throw new EncodingError(
      "utf8_invalid",
      "sha256-text mode needs a UTF-8 payload",
      { cause },
    );
  }
}

export class TurnkeyWalletSigner implements Signer {
  readonly didKey: string;
  private readonly client: TurnkeyClient;
  private readonly organizationId: string;
  private readonly walletAddress: `0x${string}`;
  private readonly mode: TurnkeySignMode;

  constructor(opts: TurnkeyWalletSignerOptions) {
    this.client = opts.client;
    this.organizationId = opts.organizationId;
    this.walletAddress = opts.walletAddress;
    this.didKey = opts.didKey;
    this.mode = opts.mode ?? "sha256-text";
  }

  async sign(payload: Uint8Array): Promise<string> {
    const params =
      this.mode === "sha256-text"
        ? {
            payload: utf8(payload),
            encoding: "PAYLOAD_ENCODING_TEXT_UTF8" as const,
            hashFunction: "HASH_FUNCTION_SHA256" as const,
          }
        : {
            payload: bytesToHex(sha256(payload)),
            encoding: "PAYLOAD_ENCODING_HEXADECIMAL" as const,
            hashFunction: "HASH_FUNCTION_NO_OP" as const,
          };
    const poller = createActivityPoller({
      client: this.client,
      requestFn: this.client.signRawPayload,
    });
    const activity = await poller({
      type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
      timestampMs: String(Date.now()),
      organizationId: this.organizationId,
      parameters: { signWith: this.walletAddress, ...params },
    });
    const res = activity.result.signRawPayloadResult;
    if (!res)
      throw new TurnkeyError("no_signature", "Turnkey returned no signature");
    const sig = rsToSig(res.r, res.s);
    if (!verifyOpSignature(payload, sig, this.didKey)) {
      throw new TurnkeyError(
        "signature_invalid",
        "Turnkey signature failed verification against the wallet did:key",
      );
    }
    return sig;
  }
}

/**
 * Resolve the wallet's secp256k1 did:key from its Turnkey account: the ETH account's publicKey,
 * else an existing ADDRESS_FORMAT_COMPRESSED account on m/44'/60'/0'/0/0 whose key derives
 * walletAddress (every such account is tried, so other wallets in the org are skipped).
 * Never creates accounts. Pass walletId to scope the account lookup to one wallet.
 */
export async function turnkeyWalletDidKey(
  client: TurnkeyClient,
  organizationId: string,
  walletAddress: `0x${string}`,
  opts: { walletId?: string } = {},
): Promise<string> {
  const { accounts } = await client.getWalletAccounts({
    organizationId,
    ...(opts.walletId ? { walletId: opts.walletId } : {}),
  });
  const want = walletAddress.toLowerCase();
  const toDidKey = (raw: string): string =>
    didKeyFromCompressed(
      "secp256k1",
      secp256k1.Point.fromBytes(hexToBytes(raw.replace(/^0x/i, ""))).toBytes(
        true,
      ),
    );
  const matches = (didKey: string): boolean =>
    ethAddressFromDidKey(didKey).toLowerCase() === want;

  const eth = accounts.find(
    (a) =>
      a.addressFormat === "ADDRESS_FORMAT_ETHEREUM" &&
      a.address.toLowerCase() === want,
  );
  if (eth?.publicKey) {
    const didKey = toDidKey(eth.publicKey);
    if (!matches(didKey))
      throw new TurnkeyError(
        "public_key_mismatch",
        `public key does not match wallet address ${walletAddress}`,
      );
    return didKey;
  }
  for (const a of accounts) {
    if (
      a.addressFormat !== "ADDRESS_FORMAT_COMPRESSED" ||
      a.path !== "m/44'/60'/0'/0/0"
    )
      continue;
    try {
      const didKey = toDidKey(a.address);
      if (matches(didKey)) return didKey;
    } catch {
      // not a valid key; try the next account
    }
  }
  throw new TurnkeyError(
    "public_key_missing",
    `no public key for ${walletAddress}: the Ethereum account has no publicKey and no ADDRESS_FORMAT_COMPRESSED account on m/44'/60'/0'/0/0 matches it`,
  );
}
