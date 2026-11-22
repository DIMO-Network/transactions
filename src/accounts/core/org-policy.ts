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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Scheme, a host of [A-Za-z0-9.-], an optional port and path: no userinfo, query, fragment, escapes or IPv6 literal. */
const ORG_HOST_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/;

/**
 * True for an https: URL, or an http: one whose host is exactly localhost or 127.0.0.1 (any
 * port), written in canonical form. The endpoint is published exactly as given, and Go
 * consumers compare it byte for byte (the org host's register check) or parse it with
 * url.Parse, so `value` must match ORG_HOST_URL_RE and equal WHATWG's `new URL(value).href`,
 * or that href less its trailing `/` (`https://org.dimo.zone` and `https://org.dimo.zone/`
 * pass; `https://Org.dimo.zone`, `:443`, `http://127.1` and `/a/../b` do not).
 */
export function isAllowedOrgHostUrl(value: string): boolean {
  if (!ORG_HOST_URL_RE.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const { href } = url;
  if (value !== href && !(href.endsWith("/") && value === href.slice(0, -1))) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** @deprecated Kept for compatibility; use isAllowedOrgHostUrl (this now also allows http: on localhost and 127.0.0.1). */
export const isHttpsUrl = isAllowedOrgHostUrl;

/**
 * Org-DID policy: a single secp256k1 root (the rotation key), an optional #signing equal to the
 * root, an optional P-256 #dimo_org, and exactly one service, `dimo_org_host`, of type
 * DimoOrgHost, whose endpoint isAllowedOrgHostUrl accepts (https:, or http: only on localhost
 * or 127.0.0.1, in canonical form).
 * `alsoKnownAs` entries are accepted as given: the person alias rules (did:ethr) do not fit org aliases such as at://avis.
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
  if (!Object.hasOwn(op.services, ORG_HOST_SERVICE)) {
    throw new PolicyError("services_not_allowed", `an org DID must carry exactly one ${ORG_HOST_SERVICE} service`);
  }
  for (const [name, svc] of Object.entries(op.services)) {
    if (name !== ORG_HOST_SERVICE) {
      throw new PolicyError("services_not_allowed", `service not allowed on an org DID: ${name}`);
    }
    if (svc.type !== ORG_HOST_SERVICE_TYPE || !isAllowedOrgHostUrl(svc.endpoint)) {
      throw new PolicyError(
        "services_not_allowed",
        `${ORG_HOST_SERVICE} must be type ${ORG_HOST_SERVICE_TYPE} with a canonical https: endpoint (http: only on localhost or 127.0.0.1)`
      );
    }
  }
}
