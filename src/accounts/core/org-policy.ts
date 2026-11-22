import { decodeDidKey } from "./didkey.js";
import { PolicyError } from "./errors.js";
import type { KeyCurve, UnsignedOperation } from "./types.js";

/** The one service an org DID carries, and its type (did-directory's OrgHostServiceType). */
export const ORG_HOST_SERVICE = "dimo_org_host";
export const ORG_HOST_SERVICE_TYPE = "DimoOrgHost";

function curveOf(key: string, what: string): KeyCurve {
  try {
    return decodeDidKey(key).curve;
  } catch {
    throw new PolicyError("key_invalid", `invalid did:key for ${what}`);
  }
}

/** True for an absolute https: URL. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Org-DID policy: a single secp256k1 root (the rotation key), an optional #signing equal to the
 * root, an optional P-256 #dimo_org, and one `dimo_org_host` service with an https: endpoint.
 * The person policy (`assertPersonDid`) is unchanged and still refuses all of this.
 */
export function assertOrgDid(op: UnsignedOperation, rootKey: string): void {
  if (op.rotationKeys.length !== 1 || op.rotationKeys[0] !== rootKey) {
    throw new PolicyError("rotation_keys", "rotationKeys must be exactly the root key");
  }
  if (curveOf(rootKey, "the root key") !== "secp256k1") {
    throw new PolicyError("root_key_type", "the org root key must be secp256k1");
  }
  for (const [fragment, key] of Object.entries(op.verificationMethods)) {
    if (fragment === "signing") {
      if (key !== rootKey) throw new PolicyError("fragment_not_allowed", "#signing must equal the root key");
    } else if (fragment === "dimo_org") {
      if (curveOf(key, "#dimo_org") !== "p256") {
        throw new PolicyError("fragment_not_allowed", "#dimo_org must be a P-256 did:key");
      }
    } else {
      throw new PolicyError("fragment_not_allowed", `verification method not allowed on an org DID: ${fragment}`);
    }
  }
  if (op.alsoKnownAs.length > 0) {
    throw new PolicyError("alias_invalid", "an org DID carries no aliases");
  }
  for (const [name, svc] of Object.entries(op.services)) {
    if (name !== ORG_HOST_SERVICE) {
      throw new PolicyError("services_not_allowed", `service not allowed on an org DID: ${name}`);
    }
    if (svc.type !== ORG_HOST_SERVICE_TYPE || !isHttpsUrl(svc.endpoint)) {
      throw new PolicyError(
        "services_not_allowed",
        `${ORG_HOST_SERVICE} must be type ${ORG_HOST_SERVICE_TYPE} with an https: endpoint`
      );
    }
  }
}
