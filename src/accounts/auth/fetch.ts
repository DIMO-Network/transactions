import { type SdkConfig, send, unboundFetch } from "../config.js";
import { createDpopProof } from "./dpop.js";
import type { Session } from "./signin.js";

/**
 * A fetch for accounts that authenticates with the session's DPoP-bound token and a
 * fresh proof per request. Uses cfg.fetchImpl; a rejected fetch becomes a NetworkError.
 */
export function authedFetch(
  cfg: Pick<SdkConfig, "fetchImpl">,
  session: Session
): (url: string, init?: RequestInit) => Promise<Response> {
  const f = unboundFetch(cfg);
  return async (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `DPoP ${session.token}`);
    headers.set(
      "DPoP",
      await createDpopProof(session.dpopKey, (init.method ?? "GET").toUpperCase(), url, session.token)
    );
    return send(f, "accounts", url, { ...init, headers });
  };
}
