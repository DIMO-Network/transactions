import { normalizeUrl, type SdkConfig, send, unboundFetch } from "../config.js";
import { parseRetryAfter, SigninError, UsageError } from "../errors.js";
import type { Signer } from "../signers/types.js";
import { createDpopProof, type DpopKey, jwkThumbprint, publicJwk } from "./dpop.js";

export type Scope = "read" | "write" | "approve";

export interface Session {
  did: string;
  token: string;
  expiresAt: Date;
  dpopKey: DpopKey;
  /**
   * Scopes dauth granted (its token response's `scope`), or the requested ones when the
   * response omits it. "approve" is needed to delete the account.
   */
  scopes: string[];
}

export interface SignInOptions {
  did: string;
  signer: Signer;
  /** Verification method fragment (no '#') of the key that signs. */
  fragment: string;
  scope: Scope[];
  /**
   * Token audience. Omit it for the default, [normalizeUrl(cfg.accountsUrl)]. An empty
   * array is a UsageError (`audience_empty`): every token names its audience.
   */
  audience?: string[];
  dpopKey: DpopKey;
}

const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST with a retry on 503/429 (dauth's directory-unavailable, rate-limit and replay-cache
 * answers; the challenge stays valid), up to 3 attempts. `headers` is called per attempt so
 * a DPoP proof is fresh each time (dauth records each proof's jti). Other statuses are final.
 */
async function post(
  f: typeof fetch,
  url: string,
  body: unknown,
  headers: () => Promise<Record<string, string>> | Record<string, string> = () => ({})
): Promise<Record<string, unknown>> {
  let res: Response;
  for (let attempt = 1; ; attempt++) {
    res = await send(f, "dauth", url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await headers()) },
      body: JSON.stringify(body),
    });
    if ((res.status !== 503 && res.status !== 429) || attempt >= MAX_ATTEMPTS) break;
    const seconds = parseRetryAfter(res.headers.get("retry-after"));
    await res.body?.cancel().catch(() => {});
    await sleep(seconds === undefined ? DEFAULT_RETRY_MS : Math.min(seconds * 1000, MAX_RETRY_MS));
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = undefined;
  }
  const obj =
    typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  if (!res.ok) {
    throw new SigninError(
      typeof obj?.error === "string" ? obj.error : "server_error",
      typeof obj?.error_description === "string" ? obj.error_description : `HTTP ${res.status}`,
      res.status,
      parseRetryAfter(res.headers.get("retry-after"))
    );
  }
  if (!obj) {
    throw new SigninError("server_error", "response is not a JSON object", res.status);
  }
  return obj;
}

const SCOPE_ORDER = ["read", "write", "approve"];

/**
 * Check the challenge is dauth's sign-in text for exactly this request before the
 * DID key signs it. Signatures over directory operations have the same form, so a
 * hostile server must never be able to pass an op payload off as a challenge.
 */
function validateChallenge(
  challenge: string,
  nonce: string,
  args: { did: string; scope: Scope[]; audience: string[] },
  jkt: string
): void {
  const bad = (why: string): never => {
    throw new SigninError("invalid_challenge", why, 200);
  };
  const lines = challenge.split("\n");
  if (!lines[0]!.endsWith(" wants you to sign in as") || lines[0]!.startsWith("{"))
    bad("challenge does not start with the sign-in preamble");
  if (lines[1] !== args.did) bad("challenge names a different DID");
  const scope = SCOPE_ORDER.filter((x) => (args.scope as string[]).includes(x)).join(" ");
  const body = "\n" + lines.slice(2).join("\n") + "\n";
  if (!body.includes(`\nKey: ${jkt}\n`)) bad("challenge names a different key");
  if (!body.includes(`\nNonce: ${nonce}\n`)) bad("challenge nonce mismatch");
  if (!body.includes(`\nScope: ${scope}\n`)) bad("challenge scope mismatch");
  const forLine = lines.find((l) => l.startsWith("For: "));
  if (forLine !== `For: ${args.audience.join(", ")}`) bad("challenge audience mismatch");
}

/** Sign in to dauth (cfg.dauthUrl) with a DID key and get a DPoP-bound access token. */
export async function signIn(cfg: SdkConfig, args: SignInOptions): Promise<Session> {
  if (args.scope.length === 0) {
    throw new UsageError("scope_missing", "signIn needs at least one scope ('read', 'write' or 'approve')");
  }
  if (args.audience?.length === 0) {
    throw new UsageError("audience_empty", "audience must not be empty; omit it for the default");
  }
  const base = normalizeUrl(cfg.dauthUrl);
  const audience = args.audience ?? [normalizeUrl(cfg.accountsUrl)];
  const jkt = await jwkThumbprint(await publicJwk(args.dpopKey));
  if (jkt !== (await args.dpopKey.thumbprint())) {
    throw new UsageError("dpop_key_invalid", "DpopKey.thumbprint() does not match its jwk()");
  }
  const challengeReq = {
    did: args.did,
    scope: args.scope.join(" "),
    jkt,
    audience,
  };
  const f = unboundFetch(cfg);
  const ch = await post(f, `${base}/signin/challenge`, challengeReq);
  const challenge = ch.challenge;
  const nonce = ch.nonce;
  if (typeof challenge !== "string" || typeof nonce !== "string") {
    throw new SigninError("server_error", "malformed challenge response", 200);
  }
  validateChallenge(challenge, nonce, { did: args.did, scope: args.scope, audience }, jkt);
  const signature = await args.signer.sign(new TextEncoder().encode(challenge));
  const tokenUrl = `${base}/signin/token`;
  const tok = await post(f, tokenUrl, { nonce, signature, key: args.fragment }, async () => ({
    DPoP: await createDpopProof(args.dpopKey, "POST", tokenUrl),
  }));
  if (
    typeof tok.token !== "string" ||
    typeof tok.expires_in !== "number" ||
    (tok.scope !== undefined && typeof tok.scope !== "string")
  ) {
    throw new SigninError("server_error", "malformed token response", 200);
  }
  const granted = typeof tok.scope === "string" ? tok.scope.split(" ").filter(Boolean) : [...args.scope];
  return {
    did: args.did,
    token: tok.token,
    expiresAt: new Date(Date.now() + tok.expires_in * 1000),
    dpopKey: args.dpopKey,
    scopes: granted,
  };
}
