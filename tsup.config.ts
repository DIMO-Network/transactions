import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "core/index": "src/core/index.ts" },
  format: ["esm", "cjs"],
  // Code splitting for CJS too, so dist/index.cjs loads core from the same shared chunk
  // as dist/core/index.cjs: one copy of core, one PolicyError (checked by check-dist).
  splitting: true,
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  noExternal: [
    "@ipld/dag-cbor",
    "cborg",
    "multiformats",
    /^@noble\//,
    /^@scure\//,
  ],
});
