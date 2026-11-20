import { normalizeUrl } from "../../src/accounts/index.js";
import {
  Failure,
  Skip,
  assertEndUserOnlyRoot,
  check,
  eq,
  newEmail,
  postJson,
  rootQuorum,
  sleep,
  type Ctx,
  type Scenario,
} from "./harness.js";

async function findSubOrg(ctx: Ctx, email: string): Promise<string> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    for (const filterType of ["EMAIL", "USERNAME"]) {
      const { organizationIds } = await ctx.parentTurnkey.getSubOrgIds({
        organizationId: ctx.env.TURNKEY_PARENT_ORG_ID,
        filterType,
        filterValue: email,
      });
      if (organizationIds[0]) return organizationIds[0];
    }
    await sleep(2000);
  }
  throw new Failure(
    "no Turnkey sub-organization appeared for the abandoned signup's email",
  );
}

/**
 * E17. Abandoned signup: POST /email-codes for a new email; don't finish. After
 * GET /internal/sweep-signups runs (CRON_SECRET, maxAgeHours=0; dev only),
 * Passes when: the sub-org's root quorum is [end user].
 *
 * The sweep is global on dev: it also closes any other abandoned signup there.
 */
export const e17: Scenario = {
  id: "E17",
  title: "abandoned signup is swept",
  async run(ctx) {
    if (!ctx.env.allowGlobalSweep) {
      throw new Skip(
        "(set E2E_ALLOW_GLOBAL_SWEEP=1) the sweep strips DIMO from every pending sub-org on dev, other developers' signups included",
      );
    }
    const email = newEmail(ctx, "e17");
    const sent = await postJson(ctx, "/email-codes", { email });
    check(
      sent.status >= 200 && sent.status < 300,
      `POST /email-codes answered ${sent.status}`,
    );
    const subOrg = await findSubOrg(ctx, email);
    // Control: before the sweep DIMO is still in the root quorum.
    const before = await rootQuorum(ctx, subOrg);
    check(
      before.userIds.length > 1,
      "setup: the abandoned sub-org's quorum already excludes DIMO before the sweep",
    );

    const res = await globalThis.fetch(
      `${normalizeUrl(ctx.env.ACCOUNTS_URL)}/api/v2/internal/sweep-signups?maxAgeHours=0`,
      { headers: { authorization: `Bearer ${ctx.env.CRON_SECRET}` } },
    );
    const summary = await res.text();
    eq(res.status, 200, `sweep status (${summary.slice(0, 200)})`);

    const deadline = Date.now() + 30_000;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        await assertEndUserOnlyRoot(ctx, subOrg, email);
        return `after the sweep ${subOrg}'s root quorum is [end user] (${summary.slice(0, 100)})`;
      } catch (e) {
        last = e;
        await sleep(2000);
      }
    }
    throw last instanceof Error
      ? last
      : new Failure("quorum never became [end user]");
  },
};
