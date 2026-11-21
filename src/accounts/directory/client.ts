import { normalizeUrl, send, unboundFetch } from "../config.js";
import { computeCid, type Operation } from "../core/index.js";
import {
  DeactivatedError,
  DidExistsError,
  DidNotFoundError,
  DirectoryIntegrityError,
  DirectoryRejectedError,
  DirectoryUnavailableError,
  HeadMovedError,
  InvalidDidError,
} from "../errors.js";
import { type AuditEntry, verifyAuditLog } from "./verify.js";

export type { AuditEntry } from "./verify.js";

export type DidDocument = {
  "@context": string[];
  id: string;
  alsoKnownAs: string[];
  verificationMethod: {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }[];
  service?: { id: string; type: string; serviceEndpoint: string }[];
  dimoControl?: {
    era: number;
    eraStart: string | null;
    controlCommitment: string;
    revocations?: unknown[];
  };
};

/** A verified head: the last audit entry's cid and operation. */
export type Head = { cid: string; op: Operation };

const DID_RE = /^did:dimo:[a-z2-7]{24}$/;

async function readBody(res: Response): Promise<{ message: string; body: unknown }> {
  const fallback = `directory returned HTTP ${res.status}`;
  try {
    const body: unknown = JSON.parse(await res.text());
    const err = (body as { error?: unknown } | null)?.error;
    return { message: typeof err === "string" ? err : fallback, body };
  } catch {
    return { message: fallback, body: undefined };
  }
}

async function readJson(did: string, res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch (cause) {
    throw new DirectoryIntegrityError(did, "response is not JSON", { cause });
  }
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;
const MAX_RETRY_AFTER_MS = 5000;

/** Retry-After as delta-seconds or an HTTP-date, clamped to [0, 5000] ms; null when absent or unparseable. */
function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after")?.trim();
  if (!h) return null;
  let ms: number;
  if (/^\d+$/.test(h)) ms = Number(h) * 1000;
  else {
    const t = Date.parse(h);
    if (Number.isNaN(t)) return null;
    ms = t - Date.now();
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/** Options for DirectoryClient. */
export type DirectoryClientOptions = {
  /** Delay between 429 retries (ms). Defaults to setTimeout; tests inject a stub. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * did-directory client. Trusts nothing it reads: head() and auditLog() verify the whole
 * audit chain, and submit() checks the returned cid is the operation's.
 *
 * The directory's ingress rate-limits per client IP and answers 429 before the request
 * reaches the service, so a 429 is retried (at most 3 times, after Retry-After clamped to
 * 5 s, else 200 ms * 2^attempt), POSTs included. A 429 that outlasts the retries throws
 * DirectoryUnavailableError (status 429). Other 5xx throw it immediately.
 */
export class DirectoryClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  /** `fetchImpl` defaults to the global fetch; it is always called unbound. */
  constructor(baseUrl: string, fetchImpl?: typeof fetch, options?: DirectoryClientOptions) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.fetch = unboundFetch({ fetchImpl });
    this.sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private url(did: string, suffix = ""): string {
    if (!DID_RE.test(did)) throw new InvalidDidError(did);
    return `${this.baseUrl}/${did}${suffix}`;
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    let res = await send(this.fetch, "directory", url, init);
    for (let attempt = 0; res.status === 429 && attempt < MAX_RETRIES; attempt++) {
      await this.sleep(retryAfterMs(res) ?? BASE_DELAY_MS * 2 ** attempt);
      res = await send(this.fetch, "directory", url, init);
    }
    if (res.status >= 500 || res.status === 429) {
      const { message } = await readBody(res);
      throw new DirectoryUnavailableError(message, res.status);
    }
    return res;
  }

  /**
   * Resolves a DID document. Unknown DID gives null. 410 throws DeactivatedError, but
   * did-directory answers 410 for any document-generation error, so use head() to
   * decide whether a DID is really tombstoned.
   */
  async resolve(did: string): Promise<DidDocument | null> {
    const res = await this.request(this.url(did));
    if (res.status === 404) return null;
    if (res.status === 410) throw new DeactivatedError(did);
    if (!res.ok) {
      const { message, body } = await readBody(res);
      throw new DirectoryRejectedError(message, res.status, body);
    }
    const doc = await readJson(did, res);
    if (typeof doc !== "object" || doc === null || (doc as { id?: unknown }).id !== did) {
      throw new DirectoryIntegrityError(did, "not a DID document for this DID");
    }
    return doc as DidDocument;
  }

  /** The whole audit log, verified (see verifyAuditLog). Includes a final tombstone. */
  async auditLog(did: string): Promise<AuditEntry[]> {
    const res = await this.request(this.url(did, "/log/audit"));
    if (res.status === 404) throw new DidNotFoundError(did);
    if (res.status === 410) throw new DeactivatedError(did);
    if (!res.ok) {
      const { message, body } = await readBody(res);
      throw new DirectoryRejectedError(message, res.status, body);
    }
    const entries = await readJson(did, res);
    if (!Array.isArray(entries)) throw new DirectoryIntegrityError(did, "audit log is not an array");
    if (entries.length === 0) throw new DidNotFoundError(did);
    return verifyAuditLog(did, entries);
  }

  /**
   * The current head, from the verified audit log. Throws DeactivatedError when the last
   * operation is a tombstone (did-directory answers 200 for a tombstoned log, never 410).
   */
  async head(did: string): Promise<Head> {
    const last = (await this.auditLog(did)).at(-1)!;
    if (last.operation.type === "plc_tombstone") throw new DeactivatedError(did);
    return { cid: last.cid, op: last.operation };
  }

  /** Submit a signed operation. The returned cid is checked against computeCid(op). */
  async submit(did: string, op: Operation): Promise<{ did: string; cid: string }> {
    const res = await this.request(this.url(did), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(op),
    });
    if (res.ok) {
      const body = (await readJson(did, res)) as {
        did?: unknown;
        cid?: unknown;
      } | null;
      const cid = computeCid(op);
      if (body?.did !== did || body.cid !== cid) {
        throw new DirectoryIntegrityError(did, `submit answered ${JSON.stringify(body)}, expected cid ${cid}`);
      }
      return { did, cid };
    }
    const { message, body } = await readBody(res);
    if (res.status === 409) {
      throw op.prev === null ? new DidExistsError(message) : new HeadMovedError(message);
    }
    throw new DirectoryRejectedError(message, res.status, body);
  }
}

/** The DirectoryClient an SDK call uses: the caller's, else one for cfg.directoryUrl and cfg.fetchImpl. */
export function directoryFor(
  cfg: { directoryUrl: string; fetchImpl?: typeof fetch },
  directory?: DirectoryClient
): DirectoryClient {
  return directory ?? new DirectoryClient(cfg.directoryUrl, cfg.fetchImpl);
}
