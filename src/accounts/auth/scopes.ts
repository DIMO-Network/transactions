import { UsageError } from "../errors.js";
import type { Scope, Session } from "./signin.js";

/**
 * Throw UsageError `scope_missing` (before any request) unless the session was granted
 * every scope in `scopes`. `what` completes "<what> requires a session with scope ...".
 */
export function requireScopes(
  session: Session,
  scopes: readonly Scope[],
  what: string,
): void {
  const missing = scopes.filter((s) => !session.scopes?.includes(s));
  if (missing.length === 0) return;
  const list = missing.map((s) => `'${s}'`).join(" and ");
  throw new UsageError(
    "scope_missing",
    `${what} requires a session with scope${missing.length > 1 ? "s" : ""} ${list}; sign in again requesting ${missing.length > 1 ? "them" : "it"}`,
  );
}
