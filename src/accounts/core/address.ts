import { keccak_256 } from "@noble/hashes/sha3.js";

import { EncodingError } from "./errors.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const enc = new TextEncoder();

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** EIP-55 checksum form of a 20-byte hex address (input case is ignored). */
export function toChecksumAddress(address: string): `0x${string}` {
  if (!ADDRESS.test(address)) {
    throw new EncodingError("address_invalid", `not a 20-byte hex address: ${JSON.stringify(address)}`);
  }
  const lower = address.slice(2).toLowerCase();
  const hash = toHex(keccak_256(enc.encode(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]!;
    out += parseInt(hash[i]!, 16) >= 8 ? ch.toUpperCase() : ch;
  }
  return out as `0x${string}`;
}

/** True only for an address already in its exact EIP-55 form (all-lower and all-upper are refused). */
export function isChecksumAddress(address: string): boolean {
  return ADDRESS.test(address) && toChecksumAddress(address) === address;
}
