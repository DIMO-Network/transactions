import { defineConfig } from "tsup";

// Builds the accounts modules (src/accounts) into dist/accounts. The rest of the package is built
// by tsc (tsconfig.build.json, which excludes src/accounts), so the two never write the same files.
// auth/index and directory/index are the light subpaths (./accounts/auth, ./accounts/directory):
// they load no smart-account, passkey or Turnkey code (checked by check-dist).
export default defineConfig({
  entry: {
    index: "src/accounts/index.ts",
    "core/index": "src/accounts/core/index.ts",
    "auth/index": "src/accounts/auth/index.ts",
    "directory/index": "src/accounts/directory/index.ts",
  },
  outDir: "dist/accounts",
  tsconfig: "tsconfig.accounts.json",
  format: ["esm", "cjs"],
  // Code splitting for CJS too, so dist/accounts/index.cjs loads core, auth and the directory from
  // the same shared chunks as the subpath entries: one copy of each, one PolicyError and one
  // SigninError (checked by check-dist).
  splitting: true,
  dts: true,
  // Cleans dist/accounts only.
  clean: true,
  sourcemap: true,
  target: "es2022",
  noExternal: ["@ipld/dag-cbor", "cborg", "multiformats", /^@noble\//, /^@scure\//],
});
