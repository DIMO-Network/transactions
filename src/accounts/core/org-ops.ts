import { PolicyError } from "./errors.js";
import { assertOrgDid, ORG_HOST_SERVICE, ORG_HOST_SERVICE_TYPE } from "./org-policy.js";
import type { Operation, UnsignedOperation } from "./types.js";

/** Org genesis: the root is the sole rotation key; `signingKey`, when given, becomes #signing (must equal the root). */
export function buildOrgGenesis(args: { rootKey: string; hostUrl: string; signingKey?: string }): UnsignedOperation {
  const op: UnsignedOperation = {
    type: "plc_operation",
    rotationKeys: [args.rootKey],
    verificationMethods: args.signingKey ? { signing: args.signingKey } : {},
    alsoKnownAs: [],
    services: { [ORG_HOST_SERVICE]: { type: ORG_HOST_SERVICE_TYPE, endpoint: args.hostUrl } },
    prev: null,
  };
  assertOrgDid(op, args.rootKey);
  return op;
}

/** Update that adds the P-256 #dimo_org key to the org head `prev`. The head must already satisfy the org policy. */
export function buildOrgKeyUpdate(prev: Operation, prevCid: string, dimoOrgKey: string): UnsignedOperation {
  const rootKey = prev.rotationKeys[0];
  if (rootKey === undefined) throw new PolicyError("rotation_keys", "head has no root key");
  assertOrgDid(prev, rootKey);
  if (Object.hasOwn(prev.verificationMethods, "dimo_org")) {
    throw new PolicyError("fragment_invalid", "fragment already exists: dimo_org");
  }
  const op: UnsignedOperation = {
    type: "plc_operation",
    rotationKeys: [...prev.rotationKeys],
    verificationMethods: { ...prev.verificationMethods, dimo_org: dimoOrgKey },
    alsoKnownAs: [],
    services: structuredClone(prev.services),
    prev: prevCid,
  };
  assertOrgDid(op, rootKey);
  return op;
}
