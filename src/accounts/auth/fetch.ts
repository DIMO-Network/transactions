import { type SdkConfig, send, unboundFetch } from "../config.js";
import { createDpopProof } from "./dpop.js";
import { serverNow, type Session } from "./signin.js";

/**
 * A fetch for accounts that authenticates with the session's DPoP-bound token and a
 * fresh proof per request. The method is upper-cased once and both sent and signed (htm),
 * since verifiers compare htm exactly and fetch upper-cases only its six standard methods.
 * The proof's iat is the device clock plus session.clockOffsetMs (dauth's clock).
 * Uses cfg.fetchImpl; a rejected fetch becomes a NetworkError.
 */
export function authedFetch(
  cfg: Pick<SdkConfig, "fetchImpl">,
  session: Session
): (url: string, init?: RequestInit) => Promise<Response> {
  const f = unboundFetch(cfg);
  return async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `DPoP ${session.token}`);
    headers.set(
      "DPoP",
      await createDpopProof(session.dpopKey, method, url, session.token, serverNow(session.clockOffsetMs))
    );
    return send(f, "accounts", url, { ...init, method, headers });
  };
}
