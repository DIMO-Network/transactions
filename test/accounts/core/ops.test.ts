import { describe, expect, it } from "vitest";

import {
  AccountSdkError,
  assertPersonDid,
  buildAddKey,
  buildGenesis,
  buildRemoveKey,
  buildSetAliases,
  buildTombstone,
  PolicyError,
  SIGNUP_POP_MESSAGE,
  toChecksumAddress,
  type UnsignedOperation,
} from "../../../src/accounts/core/index.js";
import vectors from "../fixtures/did-ops.json";

const cases = vectors.cases as unknown as {
  name: string;
  unsigned: UnsignedOperation;
  cid: string;
}[];
const byName = (n: string) => cases.find((c) => c.name === n)!;
const walletOnly = byName("genesis-wallet-only").unsigned;
const WALLET = walletOnly.rotationKeys[0]!;
const R1 = byName("genesis-wallet-r1-signing").unsigned.verificationMethods.signing!;
const K1 = byName("genesis-wallet-k1-signing-alias").unsigned.verificationMethods.signing!;
// The vectors' alias is EIP-55 (did-directory ece6b07), so the policy takes them as-is.
const ALIAS = byName("genesis-wallet-k1-signing-alias").unsigned.alsoKnownAs[0]!;
// Spec §5 requires EIP-55: the same alias in lowercase is refused.
const LOWER_ALIAS = ALIAS.toLowerCase();

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyError);
    return (e as PolicyError).code;
  }
  return undefined;
};

describe("builders match the Go vectors", () => {
  it("buildGenesis wallet only", () => {
    expect(buildGenesis({ walletKey: WALLET })).toEqual(walletOnly);
  });
  it("buildGenesis wallet + r1 signing", () => {
    expect(buildGenesis({ walletKey: WALLET, signingKey: R1 })).toEqual(byName("genesis-wallet-r1-signing").unsigned);
  });
  it("buildGenesis wallet + k1 signing + alias (vector shape, EIP-55 alias)", () => {
    expect(buildGenesis({ walletKey: WALLET, signingKey: K1, alias: ALIAS })).toEqual(
      byName("genesis-wallet-k1-signing-alias").unsigned
    );
  });
  it("buildGenesis refuses a lowercase alias", () => {
    expect(
      codeOf(() =>
        buildGenesis({
          walletKey: WALLET,
          signingKey: K1,
          alias: LOWER_ALIAS,
        })
      )
    ).toBe("alias_invalid");
  });
  it("buildAddKey equals update-add-device", () => {
    const head = byName("genesis-wallet-r1-signing");
    const { op, fragment } = buildAddKey(head.unsigned, head.cid, K1);
    expect(fragment).toBe("device-2");
    expect(op).toEqual(byName("update-add-device").unsigned);
  });
  it("buildRemoveKey equals update-remove-device", () => {
    const head = byName("update-add-device");
    expect(buildRemoveKey(head.unsigned, head.cid, "signing")).toEqual(byName("update-remove-device").unsigned);
  });
  it("buildTombstone equals tombstone", () => {
    expect(buildTombstone(byName("update-remove-device").cid)).toEqual(byName("tombstone").unsigned);
  });
  it("buildSetAliases equals update-set-alias (EIP-55 alias)", () => {
    const head = byName("genesis-wallet-only");
    expect(buildSetAliases(head.unsigned, head.cid, [ALIAS])).toEqual(byName("update-set-alias").unsigned);
  });
  it("buildSetAliases refuses a lowercase alias", () => {
    const head = byName("genesis-wallet-only");
    expect(codeOf(() => buildSetAliases(head.unsigned, head.cid, [LOWER_ALIAS]))).toBe("alias_invalid");
  });
});

describe("fragment selection and removal", () => {
  it("first added key becomes signing; second becomes device-2", () => {
    const a = buildAddKey(walletOnly, "cid0", R1);
    expect(a.fragment).toBe("signing");
    const b = buildAddKey(a.op, "cid1", K1);
    expect(b.fragment).toBe("device-2");
  });
  it("refuses to remove #wallet", () => {
    expect(codeOf(() => buildRemoveKey(walletOnly, "cid0", "wallet"))).toBe("wallet_required");
  });
  it("treats inherited Object.prototype names as absent fragments", () => {
    for (const frag of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(codeOf(() => buildRemoveKey(walletOnly, "cid0", frag))).toBe("fragment_invalid");
    }
    const { op, fragment } = buildAddKey(walletOnly, "cid0", R1, "constructor");
    expect(fragment).toBe("constructor");
    expect(Object.hasOwn(op.verificationMethods, "constructor")).toBe(true);
    expect(op.verificationMethods.constructor).toBe(R1);
  });
  it("removing the last device leaves only wallet", () => {
    const head = byName("genesis-wallet-r1-signing");
    const op = buildRemoveKey(head.unsigned, head.cid, "signing");
    expect(op.verificationMethods).toEqual({ wallet: WALLET });
  });
});

describe("assertPersonDid", () => {
  const ok = byName("genesis-wallet-r1-signing").unsigned;
  const withVm = (frag: string, key = R1): UnsignedOperation => ({
    ...ok,
    verificationMethods: { ...ok.verificationMethods, [frag]: key },
  });
  it("accepts a valid op", () => {
    expect(() => assertPersonDid(ok, WALLET)).not.toThrow();
  });
  it("rotation_locked", () => {
    expect(codeOf(() => assertPersonDid({ ...ok, rotationKeys: [WALLET, R1] }, WALLET))).toBe("rotation_locked");
    expect(codeOf(() => assertPersonDid({ ...ok, rotationKeys: [] }, WALLET))).toBe("rotation_locked");
  });
  it("wallet_required", () => {
    const rest = { ...ok.verificationMethods };
    delete rest.wallet;
    expect(codeOf(() => assertPersonDid({ ...ok, verificationMethods: rest }, WALLET))).toBe("wallet_required");
    expect(codeOf(() => assertPersonDid(withVm("wallet", R1), WALLET))).toBe("wallet_required");
  });
  it("fragment_reserved", () => {
    expect(codeOf(() => assertPersonDid(withVm("dimo_org"), WALLET))).toBe("fragment_reserved");
  });
  it("fragment_invalid", () => {
    expect(codeOf(() => assertPersonDid(withVm("bad frag!"), WALLET))).toBe("fragment_invalid");
    expect(codeOf(() => assertPersonDid(withVm("a".repeat(65)), WALLET))).toBe("fragment_invalid");
  });
  it("key_invalid", () => {
    expect(codeOf(() => assertPersonDid(withVm("x", "did:key:zNope"), WALLET))).toBe("key_invalid");
  });
  it("alias_invalid", () => {
    expect(codeOf(() => assertPersonDid({ ...ok, alsoKnownAs: ["did:web:example.com"] }, WALLET))).toBe(
      "alias_invalid"
    );
  });
  it("aliases must be EIP-55 checksummed", () => {
    expect(codeOf(() => assertPersonDid({ ...ok, alsoKnownAs: [ALIAS] }, WALLET))).toBeUndefined();
    const lower = ALIAS.toLowerCase();
    const upper = "did:ethr:137:0x" + ALIAS.slice("did:ethr:137:0x".length).toUpperCase();
    const flipped = ALIAS.replace(/[a-f]/, (c) => c.toUpperCase());
    for (const bad of [lower, upper, flipped]) {
      expect(bad).not.toBe(ALIAS);
      expect(codeOf(() => assertPersonDid({ ...ok, alsoKnownAs: [bad] }, WALLET))).toBe("alias_invalid");
    }
  });
  it("EIP-55 reference vectors", () => {
    for (const a of [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ]) {
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
    }
    expect(() => toChecksumAddress("0x123")).toThrow();
  });
  it("services_not_allowed", () => {
    expect(codeOf(() => assertPersonDid({ ...ok, services: { a: { type: "t", endpoint: "e" } } }, WALLET))).toBe(
      "services_not_allowed"
    );
  });
});

describe("error hierarchy", () => {
  it("PolicyError is an AccountSdkError with its code", () => {
    const e = new PolicyError("proof_invalid", "x");
    expect(e).toBeInstanceOf(AccountSdkError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("proof_invalid");
    expect(e.name).toBe("PolicyError");
  });
});

describe("SIGNUP_POP_MESSAGE", () => {
  it("uses real newlines", () => {
    expect(SIGNUP_POP_MESSAGE("a@b.c", "did:key:x")).toBe("DIMO accounts v2 signup\nemail: a@b.c\nkey: did:key:x");
  });
});

describe("builders refuse non-conforming heads", () => {
  const good = byName("genesis-wallet-r1-signing").unsigned;
  const rest = { ...good.verificationMethods };
  delete rest.wallet;
  const bads: [string, UnsignedOperation, string][] = [
    ["missing #wallet", { ...good, verificationMethods: rest }, "wallet_required"],
    ["extra rotation key", { ...good, rotationKeys: [...good.rotationKeys, K1] }, "rotation_locked"],
    ["services on the head", { ...good, services: { a: { type: "t", endpoint: "e" } } }, "services_not_allowed"],
  ];
  const builders: [string, (h: UnsignedOperation) => unknown][] = [
    ["buildAddKey", (h) => buildAddKey(h, "cid0", K1)],
    ["buildRemoveKey", (h) => buildRemoveKey(h, "cid0", "signing")],
    ["buildSetAliases", (h) => buildSetAliases(h, "cid0", [ALIAS])],
  ];
  for (const [bname, build] of builders) {
    it.each(bads)(`${bname}: %s`, (_n, head, code) => {
      const before = structuredClone(head);
      expect(codeOf(() => build(head))).toBe(code);
      expect(head).toEqual(before);
    });
  }
});
