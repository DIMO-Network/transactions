/**
 * A viem account whose key lives in the user's Turnkey wallet (secp256k1), for the
 * ZeroDev kernel's ECDSA validator. Only message and typed-data signing: that is all a
 * UserOp needs.
 */
import { createActivityPoller, type TurnkeyClient } from "@turnkey/http";
import { hashMessage, hashTypedData, type Hex, type LocalAccount } from "viem";
import { toAccount } from "viem/accounts";

import { Failure } from "./harness.js";

export function turnkeyViemAccount(
  client: TurnkeyClient,
  organizationId: string,
  address: `0x${string}`
): LocalAccount {
  const signHash = async (hash: Hex): Promise<Hex> => {
    const poller = createActivityPoller({
      client,
      requestFn: client.signRawPayload,
    });
    const activity = await poller({
      type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
      timestampMs: String(Date.now()),
      organizationId,
      parameters: {
        signWith: address,
        payload: hash.slice(2),
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_NO_OP",
      },
    });
    const r = activity.result.signRawPayloadResult;
    if (!r) throw new Failure("Turnkey returned no signature");
    const v = (parseInt(r.v, 16) + 27).toString(16).padStart(2, "0");
    return `0x${r.r.padStart(64, "0")}${r.s.padStart(64, "0")}${v}`;
  };
  return toAccount({
    address,
    signMessage: ({ message }) => signHash(hashMessage(message)),
    signTypedData: (typedData) => signHash(hashTypedData(typedData as Parameters<typeof hashTypedData>[0])),
    signTransaction: () => {
      throw new Failure("the e2e wallet account does not sign transactions");
    },
  });
}
