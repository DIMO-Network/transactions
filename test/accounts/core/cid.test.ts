import { describe, expect, it } from "vitest";

import { computeCid, type UnsignedOperation } from "../../../src/accounts/core/index.js";
import vectors from "../fixtures/did-ops.json";

const cases = vectors.cases as unknown as {
  name: string;
  unsigned: UnsignedOperation;
  cid: string;
  sig: string;
}[];

describe("computeCid", () => {
  it("covers every vector", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.every((c) => typeof c.cid === "string" && c.cid)).toBe(true);
  });

  it.each(cases)("matches Go ComputeCID: $name", (c) => {
    expect(computeCid(c.unsigned)).toBe(c.cid);
  });

  it.each(cases)("ignores the signature: $name", (c) => {
    expect(computeCid({ ...c.unsigned, sig: c.sig })).toBe(c.cid);
    expect(computeCid({ ...c.unsigned, sig: "other" })).toBe(c.cid);
  });

  it("changes when any field changes", () => {
    const c = cases[0]!;
    expect(computeCid({ ...c.unsigned, alsoKnownAs: ["x"] })).not.toBe(c.cid);
  });
});
