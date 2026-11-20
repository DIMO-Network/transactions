import { e01 } from "./e01-open-creation.js";
import { e02 } from "./e02-creation-with-code.js";
import { e03 } from "./e03-signin-phone-key.js";
import { e04 } from "./e04-signin-wallet.js";
import { e05 } from "./e05-add-device.js";
import { e06 } from "./e06-remove-device.js";
import { e07 } from "./e07-recovery.js";
import { e08 } from "./e08-claim-dimo-root.js";
import { e09 } from "./e09-claim-user-root.js";
import { e10 } from "./e10-smart-accounts.js";
import { e11 } from "./e11-delete.js";
import { e15 } from "./e15-enumeration.js";
import { e17 } from "./e17-abandoned.js";
import { e18 } from "./e18-bulk.js";
import type { Scenario } from "./harness.js";

/** In run order. E15 reads the account E1 made, so E1 stays first and its cleanup runs last. */
export const SCENARIOS: Scenario[] = [e01, e02, e03, e04, e05, e06, e07, e08, e09, e10, e11, e15, e17, e18];

/** Scenarios whose gate lives elsewhere (see the index plan's E-table). */
export const GATED_ELSEWHERE: Record<string, string> = {
  E12: "dauth regression: P2 CI and dev check",
  E13: "v1 regression: P4 gate diff and jest",
  E16: "non-custodial: P4 Task 11 grep",
};
