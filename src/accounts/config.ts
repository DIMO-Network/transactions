import { NetworkError, type SdkService } from "./errors.js";

export interface SdkConfig {
  accountsUrl: string;
  dauthUrl: string;
  directoryUrl: string;
  turnkeyParentOrgId: string;
  rpcUrls: Record<number, string>;
  /**
   * Optional allowlist of paymaster addresses per chain id. When a chain has an entry,
   * a sponsorship naming any other paymaster is refused before signing.
   */
  allowedPaymasters?: Record<number, readonly `0x${string}`[]>;
  /**
   * The only fetch the SDK uses, for accounts, dauth, the directory and the chain RPC.
   * Defaults to globalThis.fetch. Always called unbound, so passing `window.fetch` is fine.
   */
  fetchImpl?: typeof fetch;
}

/** A service base URL without trailing slashes; every SDK URL and the default audience go through it. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * cfg.fetchImpl (else the global fetch, looked up per call), invoked without a receiver.
 * Browsers throw "Illegal invocation" when fetch is called with `this` set to anything
 * but the global, so it must never be called as a method of an SDK object.
 */
export function unboundFetch(cfg: { fetchImpl?: typeof fetch }): typeof fetch {
  const impl = cfg.fetchImpl;
  return (input, init) => {
    const f = impl ?? globalThis.fetch;
    return f(input, init);
  };
}

/** Send a request; a rejected fetch becomes a NetworkError for `service`. */
export async function send(f: typeof fetch, service: SdkService, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await f(url, init);
  } catch (cause) {
    throw new NetworkError(service, cause);
  }
}
