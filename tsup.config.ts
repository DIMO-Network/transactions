import { defineConfig } from "tsup";

// Builds the accounts modules (src/accounts) into dist/accounts. The rest of the package is built
// by tsc (tsconfig.build.json, which excludes src/accounts), so the two never write the same files.
export default defineConfig({
  entry: { index: "src/accounts/index.ts", "core/index": "src/accounts/core/index.ts" },
  outDir: "dist/accounts",
  tsconfig: "tsconfig.accounts.json",
  format: ["esm", "cjs"],
  // Code splitting for CJS too, so dist/accounts/index.cjs loads core from the same shared chunk
  // as dist/accounts/core/index.cjs: one copy of core, one PolicyError (checked by check-dist).
  splitting: true,
  dts: true,
  // Cleans dist/accounts only.
  clean: true,
  sourcemap: true,
  target: "es2022",
  noExternal: ["@ipld/dag-cbor", "cborg", "multiformats", /^@noble\//, /^@scure\//],
});
