import { describe, expect, it } from "vitest";
import {
  EnvError,
  REQUIRED,
  isDevUrl,
  parsePartnerKey,
  readEnv,
} from "../e2e/env.js";
import { GATED_ELSEWHERE, SCENARIOS } from "../e2e/scenarios.js";

const devEnv = (): Record<string, string> => ({
  ...Object.fromEntries(REQUIRED.map((k) => [k, "x"])),
  ACCOUNTS_URL: "https://accounts.dev.dimo.org",
  DAUTH_URL: "https://dauth.dev.dimo.zone",
  DIRECTORY_URL: "https://did.dev.dimo.zone",
  E2E_WEBAUTHN_RP_ID: "dev.dimo.org",
  E2E_WEBAUTHN_ORIGIN: "https://login.dev.dimo.org",
});

// Loads every e2e scenario module, so the suite type-checks and imports without a network.
describe("e2e suite (offline smoke)", () => {
  it("has E1-E11, E15, E17 and E18, in order, each runnable", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      "E1",
      "E2",
      "E3",
      "E4",
      "E5",
      "E6",
      "E7",
      "E8",
      "E9",
      "E10",
      "E11",
      "E15",
      "E17",
      "E18",
    ]);
    for (const s of SCENARIOS) {
      expect(typeof s.run).toBe("function");
      expect(s.title).not.toBe("");
    }
    expect(Object.keys(GATED_ELSEWHERE).sort()).toEqual(["E12", "E13", "E16"]);
  });

  it("fails fast, naming every missing variable", () => {
    expect(() => readEnv({})).toThrow(EnvError);
    try {
      readEnv({});
    } catch (e) {
      for (const k of REQUIRED) expect((e as Error).message).toContain(k);
    }
  });

  it("refuses a Vercel preview as ACCOUNTS_URL", () => {
    const env = devEnv();
    env.ACCOUNTS_URL = "https://accounts-git-foo.vercel.app";
    expect(() => readEnv(env)).toThrow(/Vercel preview/);
  });

  it("reads a complete environment", () => {
    const env = devEnv();
    env.E2E_PARTNER_DID_KEY = JSON.stringify({
      did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa",
      fragment: "signing",
      privateKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" },
    });
    env.MAILBOX_API = "https://mail.example/";
    const parsed = readEnv(env);
    expect(parsed.MAILBOX_API).toBe("https://mail.example");
    expect(parsed.partner.fragment).toBe("signing");
    expect(() => parsePartnerKey("nope")).toThrow(EnvError);
  });

  it("refuses any host that is not a dev host", () => {
    for (const [k, v] of [
      ["ACCOUNTS_URL", "https://accounts.dimo.org"],
      ["DAUTH_URL", "https://dauth.dimo.zone"],
      ["DIRECTORY_URL", "https://did.dimo.zone"],
    ] as const) {
      const env = devEnv();
      env[k] = v;
      expect(() => readEnv(env)).toThrow(/not an allowed dev URL/);
    }
  });

  it("opt-ins default off", () => {
    const env = devEnv();
    env.E2E_PARTNER_DID_KEY = JSON.stringify({
      did: "did:dimo:aaaaaaaaaaaaaaaaaaaaaaaa",
      fragment: "signing",
      privateKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" },
    });
    const parsed = readEnv(env);
    expect(parsed.allowGlobalSweep).toBe(false);
    expect(parsed.allowBulk).toBe(false);
    expect(readEnv({ ...env, E2E_ALLOW_BULK: "1" }).allowBulk).toBe(true);
  });

  it("matches dev hosts by suffix on the parsed hostname", () => {
    expect(isDevUrl("https://accounts.dimo.org.dev.evil.com")).toBe(false);
    expect(isDevUrl("https://accounts.dimo.org")).toBe(false);
    expect(isDevUrl("http://accounts.dev.dimo.org")).toBe(false);
    expect(isDevUrl("https://dev.dimo.org")).toBe(false);
    expect(isDevUrl("https://accounts.dev.dimo.org")).toBe(true);
    expect(isDevUrl("https://did.dev.dimo.zone")).toBe(true);
    expect(isDevUrl("https://stage.example.com")).toBe(false);
    expect(isDevUrl("https://stage.example.com", ["stage.example.com"])).toBe(
      true,
    );
  });

  it("requires the WebAuthn rp id and origin", () => {
    const env = devEnv();
    delete env.E2E_WEBAUTHN_RP_ID;
    expect(() => readEnv(env)).toThrow(/E2E_WEBAUTHN_RP_ID/);
  });
});
