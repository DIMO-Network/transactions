import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as sdk from "../../src/accounts/index.js";
import * as core from "../../src/accounts/core/index.js";

const errorClasses = (mod: Record<string, unknown>) =>
  Object.entries(mod).filter(
    ([, v]) =>
      typeof v === "function" &&
      (v as { prototype?: unknown }).prototype instanceof Error,
  ) as [string, new (...a: never[]) => Error][];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("error hierarchy", () => {
  it("every exported error class extends AccountSdkError", () => {
    const classes = errorClasses(sdk);
    expect(classes.map(([n]) => n).sort()).toEqual(
      [
        "AccountSdkError",
        "AccountsError",
        "DeactivatedError",
        "DeleteHeadMovedError",
        "DeleteIncompleteError",
        "DidExistsError",
        "DidNotFoundError",
        "DirectoryIntegrityError",
        "DirectoryRejectedError",
        "DirectoryUnavailableError",
        "EncodingError",
        "GasProxyError",
        "HeadMovedError",
        "InvalidDidError",
        "NetworkError",
        "PolicyError",
        "ProvidersExhaustedError",
        "SignerError",
        "SigninError",
        "SponsorshipError",
        "TurnkeyError",
        "UsageError",
        "UserOperationPendingError",
        "UserOperationRevertedError",
        "UserOperationUnknownError",
      ].sort(),
    );
    for (const [name, cls] of classes) {
      expect(
        cls === sdk.AccountSdkError ||
          cls.prototype instanceof sdk.AccountSdkError,
        name,
      ).toBe(true);
    }
  });

  it("core errors are the same classes in both entry points", () => {
    for (const [name, cls] of errorClasses(core)) {
      expect((sdk as Record<string, unknown>)[name], name).toBe(cls);
    }
  });

  it("instances carry a code and their own name", () => {
    const cases: [Error & { code: string }, string, string][] = [
      [new sdk.HeadMovedError(), "HeadMovedError", "head_moved"],
      [new sdk.DeactivatedError("d"), "DeactivatedError", "did_deactivated"],
      [
        new sdk.NetworkError("accounts", new TypeError("x")),
        "NetworkError",
        "network_error",
      ],
      [
        new sdk.DirectoryIntegrityError("d", "m"),
        "DirectoryIntegrityError",
        "directory_integrity",
      ],
      [
        new sdk.SigninError("invalid_grant", "x", 401),
        "SigninError",
        "invalid_grant",
      ],
      [
        new sdk.AccountsError("did_taken", 409, "x"),
        "AccountsError",
        "did_taken",
      ],
      [new sdk.UsageError("scope_missing", "x"), "UsageError", "scope_missing"],
      [
        new sdk.TurnkeyError("no_signature", "x"),
        "TurnkeyError",
        "no_signature",
      ],
      [new sdk.SignerError("x"), "SignerError", "signer_failed"],
      [
        new sdk.GasProxyError(403, "alchemy"),
        "GasProxyError",
        "proxy_forbidden",
      ],
      [
        new sdk.ProvidersExhaustedError([new Error("a")]),
        "ProvidersExhaustedError",
        "providers_exhausted",
      ],
      [
        new sdk.UserOperationRevertedError("0x1", "alchemy", "r"),
        "UserOperationRevertedError",
        "user_operation_reverted",
      ],
      [
        new sdk.UserOperationUnknownError("0x1", "alchemy", 7n, new Error("x")),
        "UserOperationUnknownError",
        "user_operation_unknown",
      ],
    ];
    for (const [e, name, code] of cases) {
      expect(e).toBeInstanceOf(sdk.AccountSdkError);
      expect(e.name).toBe(name);
      expect(e.code).toBe(code);
    }
  });

  describe("AccountsError.fromResponse Retry-After", () => {
    const res = (retryAfter?: string) =>
      new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "slow" } }),
        {
          status: 429,
          headers:
            retryAfter === undefined ? {} : { "Retry-After": retryAfter },
        },
      );

    it("parses integer seconds", async () => {
      const e = await sdk.AccountsError.fromResponse(res("30"));
      expect(e).toMatchObject({
        code: "rate_limited",
        status: 429,
        retryAfterSeconds: 30,
      });
    });

    it.each([
      undefined,
      "Wed, 21 Oct 2026 07:28:00 GMT",
      "-5",
      "1.5",
      "abc",
      "",
    ])("ignores %s", async (h) => {
      const e = await sdk.AccountsError.fromResponse(res(h));
      expect(e.retryAfterSeconds).toBeUndefined();
    });
  });

  it("src throws no plain Error or AggregateError", () => {
    const offenders = files(join(__dirname, "../../src/accounts"))
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /new (Error|AggregateError|TypeError)\(/.test(readFileSync(f, "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
