import { describe, expect, it } from "vitest";

import {
  assertOrgDid,
  assertPersonDid,
  buildOrgGenesis,
  buildOrgKeyUpdate,
  encodeOperationCbor,
  PolicyError,
  type Operation,
  type UnsignedOperation,
} from "../../../src/accounts/core/index.js";
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

describe("assertPersonDid", () => {
  it("still refuses an org genesis", () => {
    expect(() => assertPersonDid(genesis.unsigned, ROOT)).toThrow(PolicyError);
    expect(() => assertPersonDid(update.unsigned, ROOT)).toThrow(PolicyError);
  });
});
