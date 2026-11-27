import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "@scure/base";

import { UsageError } from "../errors.js";
import { assertP256SigningPair } from "../signers/webcrypto.js";

const enc = new TextEncoder();

const b64u = (b: Uint8Array): string => base64url.encode(b).replace(/=+$/, "");

export interface DpopJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/**
 * A DPoP proof-of-possession key (ES256 / P-256). React Native apps can
 * implement this over a native keystore key.
 */
export interface DpopKey {
  jwk(): Promise<DpopJwk>;
  /** RFC 7638 thumbprint of the public JWK (what the token's cnf.jkt holds). */
  thumbprint(): Promise<string>;
  /** Raw 64-byte r||s ECDSA signature over SHA-256(data). */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

/** RFC 7638 thumbprint of an EC JWK: members in lexicographic order, no whitespace. */
export async function jwkThumbprint(jwk: DpopJwk): Promise<string> {
  const canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return b64u(sha256(enc.encode(canonical)));
}

/** A DpopKey backed by a WebCrypto pair. Persist `keyPair` (IndexedDB) and rebuild with dpopKeyFromKeyPair. */
export interface WebCryptoDpopKey extends DpopKey {
  /** The underlying pair. The private key is always non-extractable. */
  readonly keyPair: CryptoKeyPair;
}

/** Generate a non-extractable WebCrypto ECDSA P-256 DPoP key. */
export async function generateDpopKey(): Promise<WebCryptoDpopKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return dpopKeyFromKeyPair(pair);
}

/**
 * Rebuild a DPoP key from a stored WebCrypto pair, for example after reading a Session's
 * pair back from IndexedDB. Throws UsageError `dpop_key_invalid` unless the pair is ECDSA
 * P-256 with a non-extractable private key that can sign and a public key that matches it
 * (checked by signing and verifying once); null, undefined and malformed input included.
 */
export async function dpopKeyFromKeyPair(pair: CryptoKeyPair): Promise<WebCryptoDpopKey> {
  await assertP256SigningPair(pair, "dpop_key_invalid", "DPoP key pair");
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  const jwk: DpopJwk = {
    kty: "EC",
    crv: "P-256",
    x: exported.x as string,
    y: exported.y as string,
  };
  const jkt = await jwkThumbprint(jwk);
  return {
    keyPair: pair,
    jwk: async () => jwk,
    thumbprint: async () => jkt,
    sign: async (data) =>
      new Uint8Array(
        await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource)
      ),
  };
}

/** Matches a URL whose path is empty: scheme "://" authority, then only a query or fragment. */
const EMPTY_PATH = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\\]*(?:[?#]|$)/;

/**
 * htu, normalised for cross-repo contract 4 the way did-directory's Go pkg/dpop does it
 * for the five shared vectors (test/accounts/fixtures/htu-vectors.json): scheme and host
 * lowercased, `:443` dropped for https and `:80` for http, query and fragment dropped. The
 * path is the percent-encoded one the request carries (WHATWG `URL.pathname`; Go uses
 * `url.EscapedPath()`, so `/a b` is `/a%20b` on both sides), with no trailing slash added
 * or removed.
 *
 * Bare-origin URLs (no path, such as `HTTPS://EXAMPLE.COM`, which gives
 * `https://example.com`) are unsupported for DPoP: the request itself goes to `/`, so a
 * verifier would expect `https://example.com/`. Every SDK and server URL has a path.
 *
 * Known divergences from Go that no vector covers, not reconciled: this drops userinfo and
 * Go keeps it; Go escapes `|` in the path and WHATWG does not; WHATWG resolves dot
 * segments (`/a/../b` is `/b`), reads `\` as `/` and compresses IPv6 hosts, and Go does
 * none of these. Pass plain URLs without those forms. Throws the URL parser's TypeError for
 * a string that is not a URL.
 */
export function normalizeHtu(raw: string): string {
  const u = new URL(raw);
  // WHATWG lowercases the scheme and host and drops the scheme's default port for http(s).
  return `${u.protocol}//${u.host}${EMPTY_PATH.test(raw) ? "" : u.pathname}`;
}

/** The key's public JWK reduced to exactly {kty, crv, x, y}; rejects non EC/P-256 keys. */
export async function publicJwk(key: DpopKey): Promise<DpopJwk> {
  const j = (await key.jwk()) as unknown as Record<string, unknown>;
  if (j.kty !== "EC" || j.crv !== "P-256" || typeof j.x !== "string" || typeof j.y !== "string") {
    throw new UsageError("dpop_key_invalid", "DPoP key must be an EC P-256 JWK with x and y");
  }
  return { kty: "EC", crv: "P-256", x: j.x, y: j.y };
}

/**
 * Build a DPoP proof JWT (RFC 9449) for a request; `ath` is set when a token is sent.
 * `method` goes into htm exactly as given (verifiers compare it exactly), and `url`
 * through normalizeHtu into htu.
 */
export async function createDpopProof(
  key: DpopKey,
  method: string,
  url: string,
  accessToken?: string,
  now: Date = new Date()
): Promise<string> {
  const jwk = await publicJwk(key);
  const header = { typ: "dpop+jwt", alg: "ES256", jwk };
  const claims: Record<string, string | number> = {
    jti: b64u(crypto.getRandomValues(new Uint8Array(16))),
    htm: method,
    htu: normalizeHtu(url),
    iat: Math.floor(now.getTime() / 1000),
  };
  if (accessToken) claims.ath = b64u(sha256(enc.encode(accessToken)));
  const signingInput = `${b64u(enc.encode(JSON.stringify(header)))}.${b64u(enc.encode(JSON.stringify(claims)))}`;
  const sig = await key.sign(enc.encode(signingInput));
  if (sig.length !== 64) {
    throw new UsageError(
      "dpop_key_invalid",
      `DpopKey.sign must return a raw 64-byte r||s signature, got ${sig.length} bytes (DER?)`
    );
  }
  return `${signingInput}.${b64u(sig)}`;
}
