// Asserts the published accounts build (dist/accounts, from tsup) keeps the light entries
// light and shares one copy of their code:
//  1. dist/accounts/{core,auth,directory} (ESM and CJS, plus every local chunk they load)
//     import or require no external module at all: noble, scure and dag-cbor are bundled
//     in, so viem, @zerodev/*, @turnkey/* (or anything else) can never be reached from
//     ./accounts/core, ./accounts/auth or ./accounts/directory.
//  2. A browser bundle of ./accounts/auth and of ./accounts/directory (everything inlined,
//     as an app's bundler would) contains no ZeroDev, Turnkey or viem code.
//  3. ./accounts and each light entry export the very same values (CJS and ESM), so
//     `err instanceof PolicyError` holds whichever entry the app imported.
import console from "node:console";
import { createRequire } from "node:module";
import process from "node:process";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist/accounts");
const failures = [];
const fail = (msg) => failures.push(msg);

/**
 * Every file reachable from `entry` through relative imports, and the bare modules they
 * import or require. esbuild parses the files, so comments and strings never count.
 */
async function walk(entry) {
  const { metafile } = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const external = new Map();
  for (const [file, info] of Object.entries(metafile.inputs)) {
    for (const imp of info.imports) {
      if (imp.external) external.set(imp.path, file);
    }
  }
  return { files: Object.keys(metafile.inputs), external };
}

const LIGHT = ["core", "auth", "directory"];

for (const e of ["index", ...LIGHT.map((x) => `${x}/index`)]) {
  for (const ext of ["js", "cjs", "d.ts", "d.cts"]) {
    if (!existsSync(resolve(dist, `${e}.${ext}`))) {
      console.error(`check-dist FAILED: dist/accounts/${e}.${ext} is missing (tsup.config.ts entries)`);
      process.exit(1);
    }
  }
}

for (const entry of LIGHT.flatMap((e) => [`${e}/index.js`, `${e}/index.cjs`])) {
  const { files, external } = await walk(resolve(dist, entry));
  for (const [spec, file] of external) {
    // node: builtins would be fine; nothing else may load at runtime from core.
    if (!spec.startsWith("node:")) fail(`dist/accounts/${entry} reaches external "${spec}" (via ${file})`);
  }
  console.log(
    `dist/accounts/${entry}: ${files.length} file(s) [${files.join(", ")}], externals: ${[...external.keys()].join(", ") || "none"}`
  );
}

const HEAVY = /node_modules\/(@zerodev|@turnkey|viem)\//;
for (const entry of ["auth/index.js", "directory/index.js"]) {
  const { metafile } = await build({
    entryPoints: [resolve(dist, entry)],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    minify: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(metafile.inputs);
  const heavy = inputs.filter((f) => HEAVY.test(f));
  if (heavy.length) fail(`browser bundle of dist/accounts/${entry} contains ${heavy.join(", ")}`);
  const bytes = Object.values(metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(
    `browser bundle of dist/accounts/${entry}: ${bytes} bytes minified, ${inputs.length} input(s), heavy: ${heavy.length ? heavy.join(", ") : "none"}`
  );
}

/** Every value `sub` exports that `main` exports too must be the very same one (one copy). */
function sameExports(label, main, sub, mustShare) {
  const shared = Object.keys(sub).filter((k) => k in main);
  for (const k of shared) {
    if (main[k] !== sub[k]) fail(`${label}: main.${k} !== ${k} of the entry (code is duplicated)`);
  }
  if (!shared.includes(mustShare)) fail(`${label}: ${mustShare} missing from main or the entry`);
  console.log(`${label}: ${shared.length} shared export(s) checked`);
}

const require = createRequire(import.meta.url);
const MUST_SHARE = { core: "PolicyError", auth: "SigninError", directory: "DirectoryClient" };
const mainCjs = require(resolve(dist, "index.cjs"));
const mainEsm = await import(pathToFileURL(resolve(dist, "index.js")).href);
for (const e of LIGHT) {
  sameExports(`cjs ${e}`, mainCjs, require(resolve(dist, `${e}/index.cjs`)), MUST_SHARE[e]);
  sameExports(`esm ${e}`, mainEsm, await import(pathToFileURL(resolve(dist, `${e}/index.js`)).href), MUST_SHARE[e]);
}

if (failures.length) {
  console.error("check-dist FAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("check-dist OK");
