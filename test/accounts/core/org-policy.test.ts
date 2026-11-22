import { describe, expect, it } from "vitest";

import {
  assertOrgDid,
  assertPersonDid,
  buildOrgGenesis,
  buildOrgKeyUpdate,
  encodeOperationCbor,
  type Operation,
  PolicyError,
  type UnsignedOperation,
} from "../../../src/accounts/core/index.js";
import { isAllowedOrgHostUrl } from "../../../src/accounts/core/org-policy.js";
import vectors from "../fixtures/did-ops.json";

type Case = { name: string; unsigned: UnsignedOperation; cborHex: string; cid: string; sig: string };
const cases = vectors.cases as unknown as Case[];
const byName = (n: string) => cases.find((c) => c.name === n)!;
const genesis = byName("org-genesis");
const update = byName("org-update-add-dimo-org");
const ROOT = genesis.unsigned.rotationKeys[0]!;
const HOST = "https://org-host.example.com";
const DIMO_ORG = update.unsigned.verificationMethods.dimo_org!;
const R1 = byName("genesis-wallet-r1-signing").unsigned.verificationMethods.signing!;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const clone = (op: UnsignedOperation): UnsignedOperation => structuredClone(op);
const withEndpoint = (endpoint: string) => {
  const a = clone(genesis.unsigned);
  a.services.dimo_org_host!.endpoint = endpoint;
  return a;
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyError);
    return (e as PolicyError).code;
  }
  return undefined;
};

describe("org builders match the Go vectors", () => {
  it("buildOrgGenesis equals org-genesis", () => {
    const op = buildOrgGenesis({ rootKey: ROOT, hostUrl: HOST, signingKey: ROOT });
    expect(op).toEqual(genesis.unsigned);
    expect(hex(encodeOperationCbor(op))).toBe(genesis.cborHex);
  });

  it("buildOrgKeyUpdate equals org-update-add-dimo-org", () => {
    const prev: Operation = { ...genesis.unsigned, sig: genesis.sig };
    const op = buildOrgKeyUpdate(prev, genesis.cid, DIMO_ORG);
    expect(op).toEqual(update.unsigned);
    expect(hex(encodeOperationCbor(op))).toBe(update.cborHex);
  });

  it("buildOrgGenesis without signingKey omits #signing", () => {
    const op = buildOrgGenesis({ rootKey: ROOT, hostUrl: HOST });
    expect(op.verificationMethods).toEqual({});
    expect(() => assertOrgDid(op, ROOT)).not.toThrow();
  });

  it("buildOrgKeyUpdate keeps the head's alsoKnownAs", () => {
    const head = buildOrgGenesis({ rootKey: ROOT, hostUrl: HOST, signingKey: ROOT, alsoKnownAs: ["at://avis"] });
    expect(head.alsoKnownAs).toEqual(["at://avis"]);
    const op = buildOrgKeyUpdate({ ...head, sig: "" }, genesis.cid, DIMO_ORG);
    expect(op.alsoKnownAs).toEqual(["at://avis"]);
  });

  it("buildOrgGenesis refuses a signingKey that is not the root", () => {
    expect(codeOf(() => buildOrgGenesis({ rootKey: ROOT, hostUrl: HOST, signingKey: DIMO_ORG }))).toBe(
      "fragment_not_allowed"
    );
  });

  it("builders refuse a non-conforming input", () => {
    expect(codeOf(() => buildOrgGenesis({ rootKey: ROOT, hostUrl: "http://x.example" }))).toBe("services_not_allowed");
    expect(codeOf(() => buildOrgKeyUpdate({ ...genesis.unsigned, sig: "" }, genesis.cid, ROOT))).toBe(
      "fragment_not_allowed"
    );
  });
});

describe("assertOrgDid", () => {
  it("accepts the genesis and the key update", () => {
    expect(() => assertOrgDid(genesis.unsigned, ROOT)).not.toThrow();
    expect(() => assertOrgDid(update.unsigned, ROOT)).not.toThrow();
  });

  it("refuses a second rotation key, or a different one", () => {
    const a = clone(genesis.unsigned);
    a.rotationKeys.push(DIMO_ORG);
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("rotation_keys");
    expect(codeOf(() => assertOrgDid(genesis.unsigned, DIMO_ORG))).toBe("rotation_keys");
  });

  it("refuses an http: host URL", () => {
    const a = clone(genesis.unsigned);
    a.services.dimo_org_host!.endpoint = "http://org-host.example.com";
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("services_not_allowed");
  });

  it("accepts an http://localhost org host", () => {
    expect(() => assertOrgDid(withEndpoint("http://localhost"), ROOT)).not.toThrow();
    expect(() => assertOrgDid(withEndpoint("http://localhost:3000"), ROOT)).not.toThrow();
  });

  it("accepts http://127.0.0.1:27281", () => {
    expect(() => assertOrgDid(withEndpoint("http://127.0.0.1:27281"), ROOT)).not.toThrow();
  });

  // R6-F5: the host must match [A-Za-z0-9.-]+, so an IPv6 literal (even loopback) is refused.
  it("refuses http://[::1]:8080", () => {
    expect(codeOf(() => assertOrgDid(withEndpoint("http://[::1]:8080"), ROOT))).toBe("services_not_allowed");
  });

  it("still refuses http://org-host.example.com", () => {
    expect(codeOf(() => assertOrgDid(withEndpoint("http://org-host.example.com"), ROOT))).toBe("services_not_allowed");
  });

  it("refuses http://localhost.evil.com", () => {
    expect(codeOf(() => assertOrgDid(withEndpoint("http://localhost.evil.com"), ROOT))).toBe("services_not_allowed");
    expect(codeOf(() => assertOrgDid(withEndpoint("http://127.0.0.1.evil.com"), ROOT))).toBe("services_not_allowed");
  });

  it("refuses a malformed host URL and a wrong service type", () => {
    const a = clone(genesis.unsigned);
    a.services.dimo_org_host!.endpoint = "not a url";
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("services_not_allowed");
    const b = clone(genesis.unsigned);
    b.services.dimo_org_host!.type = "Other";
    expect(codeOf(() => assertOrgDid(b, ROOT))).toBe("services_not_allowed");
  });

  it("refuses an extra service", () => {
    const a = clone(genesis.unsigned);
    a.services.other = { type: "DimoOrgHost", endpoint: HOST };
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("services_not_allowed");
  });

  it("refuses a #device-1 method", () => {
    const a = clone(update.unsigned);
    a.verificationMethods["device-1"] = DIMO_ORG;
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("fragment_not_allowed");
  });

  it("refuses #signing that is not the root", () => {
    const a = clone(genesis.unsigned);
    a.verificationMethods.signing = DIMO_ORG;
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("fragment_not_allowed");
  });

  it("refuses a secp256k1 #dimo_org", () => {
    const a = clone(update.unsigned);
    a.verificationMethods.dimo_org = ROOT;
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("fragment_not_allowed");
  });

  it("refuses a P-256 root with root_key_type", () => {
    const a = clone(genesis.unsigned);
    a.rotationKeys = [R1];
    a.verificationMethods = {};
    expect(codeOf(() => assertOrgDid(a, R1))).toBe("root_key_type");
  });

  it("refuses an undecodable root", () => {
    const a = clone(genesis.unsigned);
    a.rotationKeys = ["nope"];
    expect(codeOf(() => assertOrgDid(a, "nope"))).toBe("key_invalid");
  });

  it("accepts an org with alsoKnownAs [at://avis]", () => {
    const a = clone(genesis.unsigned);
    a.alsoKnownAs = ["at://avis"];
    expect(() => assertOrgDid(a, ROOT)).not.toThrow();
  });
});

// R6-F5: the endpoint is published as given, and Go consumers compare it byte for byte
// (the org host's ServiceEndpoint == PUBLIC_URL) or parse it with url.Parse. So only a
// strict character set is accepted, and only the string WHATWG parsing leaves unchanged.
describe("isAllowedOrgHostUrl accepts only canonical URLs in a strict character set (R6-F5)", () => {
  it.each([
    "https://org-host.example.com",
    "https://org-host.example.com/",
    "https://org.dimo.zone/orgs",
    "https://org.dimo.zone/orgs/",
    "https://org.dimo.zone:8443/a_b/c~d.e-f",
    "http://localhost",
    "http://localhost/",
    "http://localhost:27281",
    "http://127.0.0.1:27281",
  ])("accepts %j", (url) => {
    expect(isAllowedOrgHostUrl(url)).toBe(true);
    expect(() => assertOrgDid(withEndpoint(url), ROOT)).not.toThrow();
  });

  it.each([
    // Characters WHATWG parsing strips, trims or rewrites (the probe in report 6, F5).
    "http://local\thost",
    "https://ev\nil.com",
    " https://evil.com",
    "https://evil.com ",
    "https://evil.com\u0000",
    "https:evil.com",
    "https:\\\\evil.com",
    "https://org.example.com\\a",
    "http:localhost",
    "https:/evil.com",
    // Userinfo, query, fragment, percent-escapes, IPv6 literals.
    "http://evil@localhost",
    "https://user:pw@org.example.com",
    "https://evil.com?q=1#f",
    "https://evil.com/?q=1",
    "https://evil.com/#f",
    "https://org.example.com/%2e",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::1]",
    // In the character set, but not what WHATWG parsing makes of it.
    "http://127.1",
    "http://2130706433",
    "http://LOCALHOST",
    "https://Org.Example.com",
    "HTTPS://org.example.com",
    "https://org.example.com:443",
    "http://localhost:80",
    "https://org.example.com:0443",
    "https://org.example.com/a/../b",
    "https://org.example.com/./a",
    "https://org.example.com/.",
    // Not a URL, another scheme, or no host.
    "",
    "not a url",
    "ftp://org.example.com",
    "https://",
    "https:///x",
    "https://org.example.com:99999",
  ])("refuses %j", (url) => {
    expect(isAllowedOrgHostUrl(url)).toBe(false);
    expect(codeOf(() => assertOrgDid(withEndpoint(url), ROOT))).toBe("services_not_allowed");
  });
});

// accounts' org flow (orgs spec §4): buildOrgGenesis with V2_ORG_HOST_URL slash-trimmed and
// signingKey = root, assertOrgDid before signing, then the #dimo_org key update.
describe("the stricter policy still accepts what accounts builds", () => {
  it.each(["https://org-host.example.com", "https://org.dev.dimo.zone", "http://localhost:27281"])(
    "genesis and key update for %s",
    (hostUrl) => {
      const op = buildOrgGenesis({ rootKey: ROOT, hostUrl, signingKey: ROOT });
      expect(op).toEqual({
        type: "plc_operation",
        rotationKeys: [ROOT],
        verificationMethods: { signing: ROOT },
        alsoKnownAs: [],
        services: { dimo_org_host: { type: "DimoOrgHost", endpoint: hostUrl } },
        prev: null,
      });
      expect(() => assertOrgDid(op, ROOT)).not.toThrow();
      const upd = buildOrgKeyUpdate({ ...op, sig: genesis.sig }, genesis.cid, DIMO_ORG);
      expect(upd.verificationMethods).toEqual({ signing: ROOT, dimo_org: DIMO_ORG });
      expect(() => assertOrgDid(upd, ROOT)).not.toThrow();
    }
  );
});

describe("assertOrgDid requires exactly one dimo_org_host service (R6-F5, R7-F3)", () => {
  it("refuses an org DID with no services", () => {
    const a = clone(genesis.unsigned);
    a.services = {};
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("services_not_allowed");
  });

  it("refuses a dimo_org_host next to another service", () => {
    const a = clone(genesis.unsigned);
    a.services = { other: { type: "DimoOrgHost", endpoint: HOST }, ...a.services };
    expect(codeOf(() => assertOrgDid(a, ROOT))).toBe("services_not_allowed");
  });

  it("buildOrgKeyUpdate refuses a head with no dimo_org_host", () => {
    const head = clone(genesis.unsigned);
    head.services = {};
    expect(codeOf(() => buildOrgKeyUpdate({ ...head, sig: genesis.sig }, genesis.cid, DIMO_ORG))).toBe(
      "services_not_allowed"
    );
  });
});

describe("assertPersonDid", () => {
  it("still refuses an org genesis", () => {
    expect(() => assertPersonDid(genesis.unsigned, ROOT)).toThrow(PolicyError);
    expect(() => assertPersonDid(update.unsigned, ROOT)).toThrow(PolicyError);
  });
});
