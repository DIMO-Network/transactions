/**
 * End-to-end suite for accounts v2 (dev only). `npm run e2e:accounts [-- --env file] [--only E1,E5]`.
 * Prints one PASS / FAIL / SKIP line per scenario and exits 1 on any FAIL, 2 on bad setup.
 */
import { AccountSdkError } from "../../src/accounts/index.js";
import { EnvError, loadEnvFile, readEnv } from "./env.js";
import {
  Failure,
  Skip,
  cleanupAll,
  makeCtx,
  noteError,
  type Ctx,
  type Scenario,
} from "./harness.js";
import { GATED_ELSEWHERE, SCENARIOS } from "./scenarios.js";

const ORDER = Array.from({ length: 18 }, (_, i) => `E${i + 1}`);

type Outcome = "PASS" | "FAIL" | "SKIP";
let failed = 0;

function line(status: string, id: string, text: string): void {
  console.log(`${status.padEnd(4)} ${id.padEnd(3)} ${text}`);
}

function describeError(e: unknown): string {
  if (e instanceof Failure || e instanceof Skip) return e.message;
  if (e instanceof AccountSdkError) return `${e.name} ${e.code}: ${e.message}`;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

const ran = new Set<string>();

async function runOne(ctx: Ctx, s: Scenario): Promise<Outcome> {
  const start = Date.now();
  let outcome: Outcome;
  let text: string;
  try {
    text = await s.run(ctx);
    outcome = "PASS";
  } catch (e) {
    noteError(ctx, e);
    text = describeError(e);
    outcome = e instanceof Skip ? "SKIP" : "FAIL";
  }
  if (outcome === "FAIL") failed++;
  if (outcome !== "SKIP") ran.add(s.id);
  line(
    outcome,
    s.id,
    `${s.title}: ${text} (${((Date.now() - start) / 1000).toFixed(1)} s)`,
  );
  return outcome;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const envFlag = argv.indexOf("--env");
  if (envFlag >= 0) {
    const file = argv[envFlag + 1];
    if (!file) {
      console.error("--env needs a file path");
      process.exit(2);
    }
    loadEnvFile(file);
  }
  const onlyFlag = argv.indexOf("--only");
  const only =
    onlyFlag >= 0
      ? new Set(
          (argv[onlyFlag + 1] ?? "")
            .split(",")
            .map((x) => x.trim().toUpperCase()),
        )
      : undefined;

  let ctx: Ctx;
  try {
    ctx = makeCtx(readEnv());
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`e2e: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  const byId = new Map(SCENARIOS.map((s) => [s.id, s]));
  try {
    for (const id of ORDER) {
      const s = byId.get(id);
      if (s) {
        if (!only || only.has(id)) await runOne(ctx, s);
      } else if (!only && id in GATED_ELSEWHERE) {
        line("N/A", id, `(gated elsewhere) ${GATED_ELSEWHERE[id]}`);
      } else if (!only && id === "E14") {
        const n = ctx.directoryRejections.length;
        const directoryRan = ORDER.slice(0, 11).filter((x) =>
          ran.has(x),
        ).length;
        if (directoryRan < 5) {
          line(
            "N/A",
            id,
            `encoding: (too few directory scenarios ran: ${directoryRan} of E1-E11)`,
          );
        } else if (n === 0) {
          line(
            "PASS",
            id,
            `encoding: 0 DirectoryRejectedErrors (and no directory 400 naming a mismatch or signature) over ${directoryRan} scenarios of E1-E11`,
          );
        } else {
          failed++;
          line(
            "FAIL",
            id,
            `encoding: ${n} directory rejection(s) over E1-E11: ${ctx.directoryRejections.slice(0, 3).join(" | ")}`,
          );
        }
      }
    }
  } finally {
    const res = await cleanupAll(ctx);
    for (const p of res.failed) console.log(`WARN cleanup: ${p}`);
    if (res.failed.length > 0) {
      failed++;
      line(
        "FAIL",
        "cleanup",
        `cleanup: ${res.failed.length} account(s) could not be deleted`,
      );
    } else {
      line(
        "PASS",
        "cleanup",
        res.leftBehind > 0
          ? `cleanup: ${res.deleted} deleted, ${res.leftBehind} left behind (bulk cleanup skipped)`
          : "cleanup: every account the suite created was deleted",
      );
    }
    console.log(
      `cleanup summary: ${res.deleted} deleted, ${res.failed.length} failed, ${res.leftBehind} left behind (bulk cleanup skipped)`,
    );
    if ((ctx.shared.e15Unknown ?? 0) > 0 && !ran.has("E17")) {
      console.log(
        `note: E15 made ${ctx.shared.e15Unknown} unknown-email sub-orgs; they stay DIMO-rooted until the next sweep because E17 did not run`,
      );
    }
  }
  console.log(failed === 0 ? "e2e: no FAIL" : `e2e: ${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`e2e: aborted: ${describeError(e)}`);
  process.exit(1);
});
