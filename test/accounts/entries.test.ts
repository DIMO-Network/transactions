// R6-F7: ./accounts/auth and ./accounts/directory must load without the smart-account,
// passkey and Turnkey code (and so without viem, ZeroDev and @turnkey/*). check-dist
// checks the built output the same way.
import { build } from "esbuild";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as auth from "../../src/accounts/auth/index.js";
import * as directory from "../../src/accounts/directory/index.js";
import * as sdk from "../../src/accounts/index.js";

const modules: Record<string, Record<string, unknown>> = { auth, directory };

const root = join(__dirname, "../..");

/** The src files and bare modules reachable from an entry. */
async function graph(entry: string) {
  const { metafile } = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "browser",
    format: "esm",
    logLevel: "silent",
  });
  const files = Object.keys(metafile.inputs);
  const externals = new Set(
    Object.values(metafile.inputs).flatMap((i) => i.imports.filter((x) => x.external).map((x) => x.path))
  );
  return { files, externals: [...externals] };
}

const HEAVY = /^(@turnkey\/|@zerodev\/|viem(\/|$))/;
const HEAVY_SRC = /src\/accounts\/(account\/|signers\/turnkey)/;

describe.each([
  [
    "auth",
    [
      "AccountSdkError",
      "AccountsError",
      "ClockSkewError",
      "KeyNotAllowedError",
      "NetworkError",
      "SigninError",
      "UsageError",
      "WebCryptoP256Signer",
      "authedFetch",
      "createDpopProof",
      "dpopKeyFromKeyPair",
      "generateDpopKey",
      "jwkThumbprint",
      "normalizeHtu",
      "normalizeUrl",
      "signIn",
    ],
  ],
  [
    "directory",
    [
      "AccountSdkError",
      "DeactivatedError",
      "DidExistsError",
      "DidNotFoundError",
      "DirectoryClient",
      "DirectoryIntegrityError",
      "DirectoryRejectedError",
      "DirectoryUnavailableError",
      "HeadMovedError",
      "InvalidDidError",
      "NetworkError",
      "verifyAuditLog",
    ],
  ],
] as const)("./accounts/%s", (name, exportsExpected) => {
  const entry = `src/accounts/${name}/index.ts`;

  it("loads no smart-account, passkey or Turnkey code, and no viem, ZeroDev or @turnkey/*", async () => {
    const { files, externals } = await graph(entry);
    expect(files.filter((f) => HEAVY_SRC.test(f))).toEqual([]);
    expect(externals.filter((x) => HEAVY.test(x))).toEqual([]);
  });

  it("exports its API, as the very same values ./accounts exports", () => {
    const mod = modules[name]!;
    expect(Object.keys(mod).sort()).toEqual([...exportsExpected].sort());
    for (const k of exportsExpected) expect(mod[k], k).toBe((sdk as Record<string, unknown>)[k]);
  });
});

it("./accounts itself does load the heavy code (what the subpaths avoid)", async () => {
  const { externals } = await graph("src/accounts/index.ts");
  expect(externals.some((x) => HEAVY.test(x))).toBe(true);
});
