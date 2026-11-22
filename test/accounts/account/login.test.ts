import type { TurnkeyClient } from "@turnkey/http";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { loginWithEmail, loginWithPasskey, requestEmailCode } from "../../../src/accounts/account/login.js";
import type { SdkConfig } from "../../../src/accounts/config.js";
import { AccountsError, NetworkError, TurnkeyError } from "../../../src/accounts/errors.js";

const base: SdkConfig = {
  accountsUrl: "https://accounts.test/",
  dauthUrl: "https://dauth.test",
  directoryUrl: "https://dir.test",
  turnkeyParentOrgId: "parent",
  rpcUrls: {},
};
const withFetch = (f: unknown): SdkConfig => ({
  ...base,
  fetchImpl: f as typeof fetch,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const wallet = "0x1111111111111111111111111111111111111111";

function tk() {
  const getWhoami = vi.fn(async () => ({ organizationId: "sub", userId: "u" }));
  const getWalletAccounts = vi.fn(async () => ({
    accounts: [
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        path: "m/44'/60'/0'/0/1",
        address: "0xother",
      },
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        path: "m/44'/60'/0'/0/0",
        address: wallet,
      },
    ],
  }));
  return {
    getWhoami,
    getWalletAccounts,
    c: { getWhoami, getWalletAccounts } as unknown as TurnkeyClient,
  };
}

describe("loginWithPasskey", () => {
  it("resolves sub-org, wallet and DID", async () => {
    const { c, getWhoami, getWalletAccounts } = tk();
    const f = vi.fn((url: string) => Promise.resolve(json({ did: "did:dimo:x", url })));
    const r = await loginWithPasskey(withFetch(f), { turnkey: c });
    expect(getWhoami).toHaveBeenCalledWith({ organizationId: "parent" });
    expect(getWalletAccounts).toHaveBeenCalledWith({ organizationId: "sub" });
    expect(f.mock.calls[0]![0]).toBe(`https://accounts.test/api/v2/accounts/by-wallet/${wallet}`);
    expect(r).toEqual({
      subOrganizationId: "sub",
      walletAddress: wallet,
      did: "did:dimo:x",
    });
  });
  it("returns did null when lookup 404s", async () => {
    const { c } = tk();
    const f = vi.fn(async () => json({ error: { code: "not_found", message: "no" } }, 404));
    const r = await loginWithPasskey(withFetch(f), { turnkey: c });
    expect(r.did).toBeNull();
  });
  it("a 404 without accounts' not_found envelope is an error, not 'no DID'", async () => {
    const { c } = tk();
    const f = vi.fn(async () => new Response("<html>nope</html>", { status: 404 }));
    await expect(loginWithPasskey(withFetch(f), { turnkey: c })).rejects.toMatchObject({
      name: "AccountsError",
      status: 404,
    });
  });
  it("maps other lookup errors to AccountsError", async () => {
    const { c } = tk();
    const f = vi.fn(async () => json({ error: { code: "boom", message: "bad" } }, 500));
    await expect(loginWithPasskey(withFetch(f), { turnkey: c })).rejects.toMatchObject({
      code: "boom",
      status: 500,
      message: "boom: bad",
    });
  });
});

describe("loginWithPasskey ambiguity", () => {
  it("throws when several accounts match the wallet path", async () => {
    const { c, getWalletAccounts } = tk();
    const acc = {
      addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      path: "m/44'/60'/0'/0/0",
    };
    getWalletAccounts.mockResolvedValue({
      accounts: [
        { ...acc, address: "0xa" },
        { ...acc, address: "0xb" },
      ],
    } as never);
    const e = await loginWithPasskey(base, { turnkey: c }).catch((x) => x);
    expect(e).toBeInstanceOf(TurnkeyError);
    expect(e.code).toBe("wallet_ambiguous");
    expect(e.message).toMatch(/multiple Ethereum/);
  });
});

// R7-F7: accounts names every org's Turnkey sub-org "DIMO org <uuid>" (orgs spec §3), with an
// org-root wallet at the same path as a person's. A browser can offer the org passkey at login
// (same RP), and logging in there would look like an account without a DID.
describe("loginWithPasskey refuses an org's sub-organization (R7-F7)", () => {
  const ORG_NAME = "DIMO org 0f8b7c1e-3a2d-4c5b-9e6f-7a8b9c0d1e2f";

  it("throws TurnkeyError org_sub_org right after whoami: no wallet read, no accounts call", async () => {
    const { c, getWhoami, getWalletAccounts } = tk();
    getWhoami.mockResolvedValue({ organizationId: "org-sub", organizationName: ORG_NAME, userId: "u" } as never);
    const f = vi.fn(async () => json({ did: "did:dimo:x" }));
    const e = await loginWithPasskey(withFetch(f), { turnkey: c }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TurnkeyError);
    expect(e).toMatchObject({ code: "org_sub_org" });
    expect((e as Error).message).toContain("org-sub");
    expect(getWalletAccounts).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses any name with the prefix, not only the exact form accounts makes", async () => {
    const { c, getWhoami } = tk();
    getWhoami.mockResolvedValue({ organizationId: "org-sub", organizationName: "DIMO org x", userId: "u" } as never);
    await expect(loginWithPasskey(base, { turnkey: c })).rejects.toMatchObject({ code: "org_sub_org" });
  });

  // The check guards against picking the wrong passkey; it is not a security boundary, and
  // a whoami without the name (a test double, an older API) logs in as before.
  it("a whoami with no organizationName logs in", async () => {
    const { c, getWhoami } = tk();
    getWhoami.mockResolvedValue({ organizationId: "sub", userId: "u", username: "a@b.c" } as never);
    const f = vi.fn(async () => json({ did: "did:dimo:x" }));
    const r = await loginWithPasskey(withFetch(f), { turnkey: c });
    expect(r).toEqual({ subOrganizationId: "sub", walletAddress: wallet, did: "did:dimo:x" });
  });

  it.each(["DIMO a@b.c", "DIMO org@example.com", "DIMO organisation@example.com", "dimo org x", ""])(
    "a person's sub-org named %j logs in as before",
    async (organizationName) => {
      const { c, getWhoami } = tk();
      getWhoami.mockResolvedValue({ organizationId: "sub", organizationName, userId: "u" } as never);
      const f = vi.fn(async () => json({ did: "did:dimo:x" }));
      const r = await loginWithPasskey(withFetch(f), { turnkey: c });
      expect(r).toEqual({ subOrganizationId: "sub", walletAddress: wallet, did: "did:dimo:x" });
    }
  );
});

describe("email login", () => {
  it("requests a code and logs in", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ codeId: "c1" }, 202))
      .mockResolvedValueOnce(
        json({
          subOrganizationId: "sub",
          walletAddress: wallet,
          did: null,
          credentialBundle: "cb",
          emailVerified: true,
          otherCredentials: false,
        })
      );
    const cfg = withFetch(f);
    expect(await requestEmailCode(cfg, { email: "a@b.c" })).toEqual({
      codeId: "c1",
    });
    const r = await loginWithEmail(cfg, {
      email: "a@b.c",
      codeId: "c1",
      code: "123456",
      sessionPublicKey: "pk",
    });
    expect(r.credentialBundle).toBe("cb");
    expect(f.mock.calls[0]![0]).toBe("https://accounts.test/api/v2/email-codes");
    expect(f.mock.calls[1]![0]).toBe("https://accounts.test/api/v2/login/email");
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({
      email: "a@b.c",
      codeId: "c1",
      code: "123456",
      sessionPublicKey: "pk",
    });
  });
  it("throws AccountsError built from the error body", async () => {
    const f = vi.fn(async () => json({ error: { code: "invalid_code", message: "wrong code" } }, 401));
    const err = await requestEmailCode(withFetch(f), {
      email: "a@b.c",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AccountsError);
    expect(err).toMatchObject({ code: "invalid_code", status: 401 });
    expect(err.message).toBe("invalid_code: wrong code");
  });
  it("tolerates a non-JSON error body", async () => {
    const f = vi.fn(async () => new Response("oops", { status: 502 }));
    const err = await requestEmailCode(withFetch(f), {
      email: "a@b.c",
    }).catch((e) => e);
    expect(err).toMatchObject({ code: "unknown_error", status: 502 });
  });
  it.each([
    ["not JSON", () => new Response("<html>", { status: 200 })],
    ["the wrong shape", () => json({ id: 1 }, 202)],
  ])("a 2xx that is %s is AccountsError invalid_response", async (_n, res) => {
    const err = await requestEmailCode(
      withFetch(async () => res()),
      {
        email: "a@b.c",
      }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AccountsError);
    expect(err.code).toBe("invalid_response");
  });
  it("guards the login body too", async () => {
    const err = await loginWithEmail(
      withFetch(async () => json({ subOrganizationId: "s", walletAddress: "nope", did: null })),
      { email: "a", codeId: "c", code: "1", sessionPublicKey: "pk" }
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "invalid_response" });
  });
  it("wraps a fetch rejection in NetworkError", async () => {
    const boom = new TypeError("fetch failed");
    const err = await requestEmailCode(
      withFetch(async () => {
        throw boom;
      }),
      { email: "a@b.c" }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.service).toBe("accounts");
    expect(err.cause).toBe(boom);
  });
});

describe("email login answer carries emailVerified and otherCredentials (contract 2)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    subOrganizationId: "sub",
    walletAddress: wallet,
    did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa",
    credentialBundle: "cb",
    emailVerified: false,
    otherCredentials: true,
    ...over,
  });
  const login = (res: Record<string, unknown>) =>
    loginWithEmail(
      withFetch(async () => json(res)),
      { email: "a@b.c", codeId: "c", code: "1", sessionPublicKey: "pk" }
    );

  it("returns both booleans as accounts sent them", async () => {
    const r = await login(body());
    expect(r).toEqual(body());
    expectTypeOf(r.emailVerified).toEqualTypeOf<boolean>();
    expectTypeOf(r.otherCredentials).toEqualTypeOf<boolean>();
    expect(await login(body({ emailVerified: true, otherCredentials: false }))).toMatchObject({
      emailVerified: true,
      otherCredentials: false,
    });
  });

  it.each([
    ["emailVerified missing", { emailVerified: undefined }],
    ["otherCredentials missing", { otherCredentials: undefined }],
    ["emailVerified not a boolean", { emailVerified: "true" }],
    ["otherCredentials not a boolean", { otherCredentials: 0 }],
  ])("%s is AccountsError invalid_response (never a reassuring default)", async (_n, over) => {
    const err = await login(body(over)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountsError);
    expect(err).toMatchObject({ code: "invalid_response" });
  });
});
