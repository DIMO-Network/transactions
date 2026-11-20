/** The e2e environment: required variables fail fast with one clear message. */
import { readFileSync } from "node:fs";

export const REQUIRED = [
  "ACCOUNTS_URL",
  "DAUTH_URL",
  "DIRECTORY_URL",
  "RPC_URL_80002",
  "CRON_SECRET",
  "TURNKEY_PARENT_ORG_ID",
  "TURNKEY_API_PUBLIC_KEY",
  "TURNKEY_API_PRIVATE_KEY",
  "E2E_EMAIL_DOMAIN",
  "E2E_PARTNER_DID_KEY",
  "MAILBOX_API",
  "E2E_WEBAUTHN_RP_ID",
  "E2E_WEBAUTHN_ORIGIN",
] as const;

export type PartnerKey = {
  did: string;
  fragment: string;
  /** An ECDSA P-256 private JWK (with d). */
  privateKeyJwk: JsonWebKey;
};

export interface E2eEnv {
  ACCOUNTS_URL: string;
  DAUTH_URL: string;
  DIRECTORY_URL: string;
  RPC_URL_80002: string;
  CRON_SECRET: string;
  TURNKEY_PARENT_ORG_ID: string;
  TURNKEY_API_PUBLIC_KEY: string;
  TURNKEY_API_PRIVATE_KEY: string;
  E2E_EMAIL_DOMAIN: string;
  partner: PartnerKey;
  MAILBOX_API: string;
  TURNKEY_BASE_URL: string;
  signMode: "sha256-text" | "noop-digest";
  gasProvider: "alchemy" | "gelato" | "pimlico";
  bulkCleanup: boolean;
  allowGlobalSweep: boolean;
  allowBulk: boolean;
  rpId: string;
  origin: string;
  cleanupConcurrency: number;
}

/** KEY=VALUE lines into process.env (existing variables win). */
export function loadEnvFile(path: string): void {
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let val = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

export class EnvError extends Error {}

/**
 * The suite creates, sweeps and deletes real accounts and sends CRON_SECRET, so it runs only
 * against dev. A URL passes only if it is https and its parsed hostname ENDS with one of these
 * suffixes (and is longer than the suffix), or equals an exact host from E2E_EXTRA_DEV_HOSTS.
 * A substring match would accept accounts.dimo.org.dev.evil.com.
 */
export const DEV_HOST_SUFFIXES: readonly string[] = [
  ".dev.dimo.org",
  ".dev.dimo.zone",
];

export function isDevUrl(
  raw: string,
  extraHosts: readonly string[] = [],
): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return (
    extraHosts.includes(h) ||
    DEV_HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length)
  );
}

function assertDevUrl(
  name: string,
  raw: string,
  extra: readonly string[],
): void {
  if (!isDevUrl(raw, extra)) {
    throw new EnvError(
      `${name} (${raw}) is not an allowed dev URL: refusing to run. It must be https with a host ending in ${DEV_HOST_SUFFIXES.join(" or ")} (or listed exactly in E2E_EXTRA_DEV_HOSTS)`,
    );
  }
}

export function parsePartnerKey(raw: string): PartnerKey {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new EnvError("E2E_PARTNER_DID_KEY is not JSON");
  }
  const o = v as Partial<PartnerKey> | null;
  if (
    !o ||
    typeof o.did !== "string" ||
    typeof o.fragment !== "string" ||
    typeof o.privateKeyJwk !== "object" ||
    o.privateKeyJwk === null ||
    typeof o.privateKeyJwk.d !== "string"
  ) {
    throw new EnvError(
      'E2E_PARTNER_DID_KEY must be JSON {"did":"did:dimo:...","fragment":"signing","privateKeyJwk":{ECDSA P-256 private JWK}}',
    );
  }
  return { did: o.did, fragment: o.fragment, privateKeyJwk: o.privateKeyJwk };
}

/** Read and validate the environment. Throws EnvError listing everything that is wrong. */
export function readEnv(src: NodeJS.ProcessEnv = process.env): E2eEnv {
  const missing = REQUIRED.filter((k) => !src[k]?.trim());
  if (missing.length > 0) {
    throw new EnvError(
      `missing required environment variables: ${missing.join(", ")}.\nSee e2e/env.example; pass a file with: npm run e2e -- --env path/to/file`,
    );
  }
  const get = (k: (typeof REQUIRED)[number]): string => src[k]!.trim();
  if (/vercel\.app/i.test(get("ACCOUNTS_URL"))) {
    throw new EnvError(
      "ACCOUNTS_URL must be the dev host (https://accounts.dev.dimo.org), never a Vercel preview: the token audience would not match",
    );
  }
  const extraHosts = (src.E2E_EXTRA_DEV_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  for (const k of ["ACCOUNTS_URL", "DAUTH_URL", "DIRECTORY_URL"] as const) {
    assertDevUrl(k, get(k), extraHosts);
  }
  const signMode = src.E2E_TURNKEY_SIGN_MODE?.trim() || "sha256-text";
  if (signMode !== "sha256-text" && signMode !== "noop-digest") {
    throw new EnvError(
      "E2E_TURNKEY_SIGN_MODE must be sha256-text or noop-digest",
    );
  }
  const gas = src.E2E_GAS_PROVIDER?.trim() || "alchemy";
  if (gas !== "alchemy" && gas !== "gelato" && gas !== "pimlico") {
    throw new EnvError("E2E_GAS_PROVIDER must be alchemy, gelato or pimlico");
  }
  const conc = Number(src.E2E_CLEANUP_CONCURRENCY ?? "5");
  return {
    ACCOUNTS_URL: get("ACCOUNTS_URL"),
    DAUTH_URL: get("DAUTH_URL"),
    DIRECTORY_URL: get("DIRECTORY_URL"),
    RPC_URL_80002: get("RPC_URL_80002"),
    CRON_SECRET: get("CRON_SECRET"),
    TURNKEY_PARENT_ORG_ID: get("TURNKEY_PARENT_ORG_ID"),
    TURNKEY_API_PUBLIC_KEY: get("TURNKEY_API_PUBLIC_KEY"),
    TURNKEY_API_PRIVATE_KEY: get("TURNKEY_API_PRIVATE_KEY"),
    E2E_EMAIL_DOMAIN: get("E2E_EMAIL_DOMAIN"),
    partner: parsePartnerKey(get("E2E_PARTNER_DID_KEY")),
    MAILBOX_API: get("MAILBOX_API").replace(/\/+$/, ""),
    TURNKEY_BASE_URL: src.TURNKEY_BASE_URL?.trim() || "https://api.turnkey.com",
    signMode,
    gasProvider: gas,
    bulkCleanup: src.E2E_BULK_CLEANUP?.trim() !== "0",
    allowGlobalSweep: src.E2E_ALLOW_GLOBAL_SWEEP?.trim() === "1",
    allowBulk: src.E2E_ALLOW_BULK?.trim() === "1",
    origin: get("E2E_WEBAUTHN_ORIGIN"),
    rpId: get("E2E_WEBAUTHN_RP_ID"),
    cleanupConcurrency: Number.isInteger(conc) && conc > 0 ? conc : 5,
  };
}
