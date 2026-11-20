import { check, type Ctx, eq, Failure, newEmail, postJson, type Scenario } from "./harness.js";

const CALLS = 20;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_P95_GAP_MS = 50;

type Sample = { status: number; keys: string; codeIdOk: boolean; ms: number };

async function sample(ctx: Ctx, email: string): Promise<Sample> {
  const start = performance.now();
  const res = await postJson(ctx, "/email-codes", { email });
  const ms = performance.now() - start;
  const body = res.body as Record<string, unknown> | undefined;
  return {
    status: res.status,
    keys: JSON.stringify(Object.keys(body ?? {}).sort()),
    codeIdOk: typeof body?.codeId === "string" && UUID_V4.test(body.codeId),
    ms,
  };
}

/** Nearest-rank p95. */
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(0.95 * xs.length) - 1]!;

/**
 * E15. No account enumeration: POST /api/v2/email-codes for a known email (one E1 created)
 * and for unknown emails, 20 sequential calls each (interleaved, a fresh unknown email per
 * call, as a prober would use).
 * Passes when: the same status, the same body keys, a UUID v4 codeId either way, and p95
 * latencies less than 50 ms apart.
 */
export const e15: Scenario = {
  id: "E15",
  title: "no account enumeration",
  async run(ctx) {
    const known = ctx.shared.knownEmail;
    if (!known) throw new Failure("needs the account E1 created, and E1 did not create one");
    const WARMUP = 2;
    const attempts: string[] = [];
    const all: Sample[] = [];
    const measure = async (n: number): Promise<Sample[][]> => {
      const k: Sample[] = [];
      const u: Sample[] = [];
      for (let i = 0; i < n; i++) {
        k.push(await sample(ctx, known));
        ctx.lastCodeAt.set(known, Date.now());
        u.push(await sample(ctx, newEmail(ctx, "e15")));
      }
      ctx.shared.e15Unknown = (ctx.shared.e15Unknown ?? 0) + n;
      return [k, u];
    };
    // Warm-up calls (connections, cold paths) are made and thrown away.
    await measure(WARMUP);
    let gap = Infinity;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const [k, u] = (await measure(CALLS)) as [Sample[], Sample[]];
      all.push(...k, ...u);
      const pk = p95(k.map((s) => s.ms));
      const pu = p95(u.map((s) => s.ms));
      gap = Math.abs(pk - pu);
      attempts.push(
        `attempt ${attempt}: p95 known ${pk.toFixed(1)} ms, unknown ${pu.toFixed(1)} ms, gap ${gap.toFixed(1)} ms`
      );
      if (gap < MAX_P95_GAP_MS) break;
    }
    const statuses = new Set(all.map((s) => s.status));
    check(statuses.size === 1, `status differs: ${JSON.stringify([...statuses])}`);
    const keys = new Set(all.map((s) => s.keys));
    check(keys.size === 1, `body keys differ: ${JSON.stringify([...keys])}`);
    eq(
      all.every((s) => s.codeIdOk),
      true,
      "every codeId is a UUID v4"
    );
    check(
      gap < MAX_P95_GAP_MS,
      `p95 latencies differ by 50 ms or more (limit ${MAX_P95_GAP_MS}): ${attempts.join("; ")}`
    );
    return `${[...statuses][0]}, keys ${[...keys][0]}, UUID v4 codeIds; ${attempts.join("; ")}`;
  },
};
