// Asserts the published accounts build (dist/accounts, from tsup) keeps core light and shares
// one copy of it:
//  1. dist/accounts/core (ESM and CJS, plus every local chunk they load) imports or requires
//     no external module at all: noble, scure and dag-cbor are bundled in, so viem,
//     @zerodev/*, @turnkey/* (or anything else) can never be reached from ./accounts/core.
//  2. ./accounts and ./accounts/core export the very same classes (CJS and ESM), so
//     `err instanceof PolicyError` holds whichever entry the app imported.
import console from "node:console";
import { createRequire } from "node:module";
import process from "node:process";
import { build } from "esbuild";
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

for (const entry of ["core/index.js", "core/index.cjs"]) {
  const { files, external } = await walk(resolve(dist, entry));
  for (const [spec, file] of external) {
    // node: builtins would be fine; nothing else may load at runtime from core.
    if (!spec.startsWith("node:"))
      fail(`dist/accounts/${entry} reaches external "${spec}" (via ${file})`);
  }
  console.log(
    `dist/accounts/${entry}: ${files.length} file(s) [${files.join(", ")}], externals: ${[...external.keys()].join(", ") || "none"}`,
  );
}

function sameExports(label, main, core) {
  const shared = Object.keys(core).filter((k) => k in main);
  const classes = shared.filter(
    (k) => typeof core[k] === "function" && /^[A-Z]/.test(k),
  );
  for (const k of classes) {
    if (main[k] !== core[k])
      fail(`${label}: main.${k} !== core.${k} (core is duplicated)`);
  }
  if (!classes.includes("PolicyError"))
    fail(`${label}: PolicyError missing from main or core`);
  console.log(
    `${label}: ${classes.length} shared class(es) checked: ${classes.join(", ")}`,
  );
}

const require = createRequire(import.meta.url);
sameExports(
  "cjs",
  require(resolve(dist, "index.cjs")),
  require(resolve(dist, "core/index.cjs")),
);
sameExports(
  "esm",
  await import(pathToFileURL(resolve(dist, "index.js")).href),
  await import(pathToFileURL(resolve(dist, "core/index.js")).href),
);

if (failures.length) {
  console.error("check-dist FAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("check-dist OK");
