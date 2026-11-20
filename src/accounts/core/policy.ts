import { isChecksumAddress } from "./address.js";
import { decodeDidKey } from "./didkey.js";
import { PolicyError } from "./errors.js";
import type { UnsignedOperation } from "./types.js";

const FRAGMENT = /^[A-Za-z0-9_.-]{1,64}$/;
/** True for a syntactically valid verification-method fragment (without the leading #). */
export const isValidFragment = (fragment: string): boolean =>
  FRAGMENT.test(fragment);
// did:ethr:<chainId>:<EIP-55 address> (spec §5); the checksum is checked separately.
const ALIAS = /^did:ethr:\d{1,10}:(0x[0-9a-fA-F]{40})$/;

export function assertPersonDid(
  op: UnsignedOperation,
  walletKey: string,
): void {
  if (op.rotationKeys.length !== 1 || op.rotationKeys[0] !== walletKey) {
    throw new PolicyError(
      "rotation_locked",
      "rotationKeys must be exactly the wallet key",
    );
  }
  if (op.verificationMethods.wallet !== walletKey) {
    throw new PolicyError(
      "wallet_required",
      "verificationMethods.wallet must be the wallet key",
    );
  }
  for (const [fragment, key] of Object.entries(op.verificationMethods)) {
    if (fragment === "dimo_org")
      throw new PolicyError("fragment_reserved", "dimo_org is reserved");
    if (!FRAGMENT.test(fragment))
      throw new PolicyError(
        "fragment_invalid",
        `invalid fragment: ${fragment}`,
      );
    try {
      decodeDidKey(key);
    } catch {
      throw new PolicyError(
        "key_invalid",
        `invalid did:key for fragment ${fragment}`,
      );
    }
  }
  for (const alias of op.alsoKnownAs) {
    const m = ALIAS.exec(alias);
    if (!m) throw new PolicyError("alias_invalid", `invalid alias: ${alias}`);
    if (!isChecksumAddress(m[1]!)) {
      throw new PolicyError(
        "alias_invalid",
        `alias address is not EIP-55 checksummed: ${alias}`,
      );
    }
  }
  if (Object.keys(op.services).length > 0) {
    throw new PolicyError("services_not_allowed", "services must be empty");
  }
}
