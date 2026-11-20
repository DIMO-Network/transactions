import {
  Failure,
  Skip,
  accountsApi,
  newEmail,
  sleep,
  track,
  type Ctx,
  type Scenario,
} from "./harness.js";

const TOTAL = 300;
const WINDOW_MS = 60_000;

async function create(
  ctx: Ctx,
  email: string,
): Promise<{ status: number; code?: string }> {
  try {
    const res = await globalThis.fetch(`${accountsApi(ctx)}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const text = await res.text();
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
    } catch {
      /* not JSON */
    }
    return { status: res.status, ...(code ? { code } : {}) };
  } catch (e) {
    return { status: 0, code: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * E18. Partner bulk creation: 300 POST /accounts in 60 s from one client.
 * Passes when: all return 201 (accounts doesn't throttle; its directory client absorbs
 * any ingress 429 with backoff).
 *
 * Precondition: V2_PUBLIC_RATE_LIMIT_PER_MINUTE is unset or >= 300 on dev. A 429 on the
 * first request is a SKIP naming that; any later 429 is a FAIL.
 */
export const e18: Scenario = {
  id: "E18",
  title: "partner bulk creation",
  async run(ctx) {
    if (!ctx.env.allowBulk) {
      throw new Skip(
        "(set E2E_ALLOW_BULK=1) it creates 300 Turnkey sub-orgs and mailbox traffic on dev",
      );
    }
    const emails = Array.from({ length: TOTAL }, () => newEmail(ctx, "e18"));
    const first = await create(ctx, emails[0]!);
    if (first.status === 429) {
      throw new Skip(
        "the first request was already 429: dev's V2_PUBLIC_RATE_LIMIT_PER_MINUTE must be unset or >= 300 for E18",
      );
    }
    const results = [first];
    track(ctx, "E18", emails[0]!);
    // Open loop: one request every WINDOW_MS / (TOTAL - 1) ms, never waiting for answers.
    const started = Date.now();
    const pending: Promise<void>[] = [];
    for (let i = 1; i < TOTAL; i++) {
      const at = started + Math.round((i * WINDOW_MS) / (TOTAL - 1));
      await sleep(Math.max(0, at - Date.now()));
      const email = emails[i]!;
      pending.push(
        create(ctx, email).then((r) => {
          results.push(r);
          if (r.status === 201) track(ctx, "E18", email);
        }),
      );
    }
    const sentIn = Date.now() - started;
    await Promise.all(pending);
    const histogram = new Map<string, number>();
    for (const r of results) {
      const k =
        r.status === 201 ? "201" : `${r.status}${r.code ? ` ${r.code}` : ""}`;
      histogram.set(k, (histogram.get(k) ?? 0) + 1);
    }
    const summary = [...histogram].map(([k, n]) => `${n}x ${k}`).join(", ");
    const created = results.filter((r) => r.status === 201).length;
    if (created !== TOTAL) {
      throw new Failure(
        `${created}/${TOTAL} returned 201 (${summary}); all ${TOTAL} requests were sent in ${(sentIn / 1000).toFixed(1)} s`,
      );
    }
    return `${TOTAL}/${TOTAL} returned 201; all sent in ${(sentIn / 1000).toFixed(1)} s, done in ${((Date.now() - started) / 1000).toFixed(1)} s`;
  },
};
