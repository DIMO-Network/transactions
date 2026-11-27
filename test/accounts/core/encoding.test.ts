import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import {
  AccountSdkError,
  deriveDid,
  encodeOperationCbor,
  encodeSigningPayload,
  EncodingError,
  type UnsignedOperation,
} from "../../../src/accounts/core/index.js";
import vectors from "../fixtures/did-ops.json";

const cases = vectors.cases as unknown as {
  name: string;
  unsigned: UnsignedOperation;
  payloadHex: string;
  cborHex: string;
  did: string;
}[];

describe("encodeSigningPayload", () => {
  it.each(cases)("matches Go byte for byte: $name", (c) => {
    expect(bytesToHex(encodeSigningPayload(c.unsigned))).toBe(c.payloadHex);
  });
  it("escapes like Go", () => {
    const op = {
      ...cases[0]!.unsigned,
      services: { x: { type: "a<b>&", endpoint: " " } },
    };
    const s = new TextDecoder().decode(encodeSigningPayload(op));
    expect(s).toContain('"a\\u003cb\\u003e\\u0026"');
    expect(s).toContain("\\u2028");
  });
  it("escapes control characters, quotes and backslashes like Go", () => {
    const op = {
      ...cases[0]!.unsigned,
      alsoKnownAs: ['a"b\\c\n\r\t\u0001\u001f\u007f'],
    };
    const s = new TextDecoder().decode(encodeSigningPayload(op));
    expect(s).toContain('"a\\"b\\\\c\\n\\r\\t\\u0001\\u001f\u007f"');
  });
  it("sorts map keys by UTF-8 byte order and emits raw UTF-8", () => {
    const op = {
      ...cases[0]!.unsigned,
      verificationMethods: { "\u{1F600}": "b", "～": "a", é: "c" },
    };
    const s = new TextDecoder().decode(encodeSigningPayload(op));
    expect(s).toContain('{"é":"c","～":"a","\u{1F600}":"b"}');
  });
});

describe("encodeSigningPayload Go edge cases", () => {
  const str = (aka: string, vm?: Record<string, string>) =>
    new TextDecoder().decode(
      encodeSigningPayload({
        ...cases[0]!.unsigned,
        alsoKnownAs: [aka],
        ...(vm ? { verificationMethods: vm } : {}),
      })
    );
  it("writes backspace and form feed as \\b and \\f", () => {
    expect(str("a\bb\fc")).toContain('"a\\bb\\fc"');
  });
  it("refuses a lone surrogate: Go would re-marshal it as raw U+FFFD, so no signature could verify", () => {
    for (const bad of ["a\ud800b", "a\udc00b", "a\ud800", "\udfff"]) {
      let err: unknown;
      try {
        str(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(EncodingError);
      expect(err).toBeInstanceOf(AccountSdkError);
      expect((err as EncodingError).code).toBe("lone_surrogate");
    }
    // a surrogate pair is fine and stays raw UTF-8
    expect(str("a\u{1F600}b")).toContain('"a\u{1F600}b"');
  });
  it("refuses a lone surrogate in map keys and services too", () => {
    const u = cases[0]!.unsigned;
    expect(() => encodeSigningPayload({ ...u, verificationMethods: { "\ud800": "x" } })).toThrow(EncodingError);
    expect(() =>
      encodeSigningPayload({
        ...u,
        services: { a: { type: "t", endpoint: "\udc00" } },
      })
    ).toThrow(EncodingError);
  });
  it("orders astral vs BMP map keys by UTF-8 bytes (not UTF-16 units)", () => {
    // UTF-16 order would put U+1F600 (d83d) before U+FF5E; UTF-8 puts it after.
    const s = str("x", { "\u{1F600}": "b", "\uff5e": "a" });
    expect(s.indexOf("\uff5e")).toBeLessThan(s.indexOf("\u{1F600}"));
  });
  it("escapes <, > and & as \\u003c, \\u003e, \\u0026", () => {
    expect(str("<>&")).toContain('"\\u003c\\u003e\\u0026"');
  });
});

describe("encodeOperationCbor", () => {
  it.each(cases)("matches fxamacker byte for byte: $name", (c) => {
    expect(bytesToHex(encodeOperationCbor(c.unsigned))).toBe(c.cborHex);
  });
});

describe("deriveDid", () => {
  it.each(cases.filter((c) => c.did))("matches Go: $name", (c) => {
    expect(deriveDid(c.unsigned)).toBe(c.did);
  });
});

describe("encodeSigningPayload field order independence", () => {
  const rev = <T>(o: Record<string, T>, f: (v: T) => T = (v) => v): Record<string, T> =>
    Object.fromEntries(
      Object.entries(o)
        .reverse()
        .map(([k, v]) => [k, f(v)])
    );
  it.each(cases)("shuffled key order gives identical bytes: $name", (c) => {
    const u = c.unsigned;
    const shuffled = rev({
      ...u,
      verificationMethods: rev(u.verificationMethods),
      services: rev(u.services, (s) => rev(s) as typeof s),
    }) as unknown as UnsignedOperation;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(u));
    expect(bytesToHex(encodeSigningPayload(shuffled))).toBe((c as unknown as { payloadHex: string }).payloadHex);
  });
});
