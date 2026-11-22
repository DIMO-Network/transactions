import { PolicyError } from "./errors.js";
import { assertOrgDid, ORG_HOST_SERVICE, ORG_HOST_SERVICE_TYPE } from "./org-policy.js";
import type { Operation, UnsignedOperation } from "./types.js";

/**
 * Org genesis (orgs spec §4): the root is the sole rotation key and #signing, and
 * `dimo_org_host` points at `hostUrl`. `signingKey` defaults to `rootKey` and must equal it:
 * the directory refuses an operation with no verification method, so #signing is always set.
 */
export function buildOrgGenesis(args: {
  rootKey: string;
  hostUrl: string;
  /** Defaults to `rootKey`; anything else is PolicyError `fragment_not_allowed`. */
  signingKey?: string;
  alsoKnownAs?: string[];
}): UnsignedOperation {
  const op: UnsignedOperation = {
    type: "plc_operation",
    rotationKeys: [args.rootKey],
    verificationMethods: { signing: args.signingKey ?? args.rootKey },
    alsoKnownAs: [...(args.alsoKnownAs ?? [])],
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
    alsoKnownAs: [...prev.alsoKnownAs],
    services: structuredClone(prev.services),
    prev: prevCid,
  };
  assertOrgDid(op, rootKey);
  return op;
}
