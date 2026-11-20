import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { base64url } from "@scure/base";
import { vi } from "vitest";
import vectors from "./fixtures/did-ops.json";
import {
  buildGenesis,
  computeCid,
  deriveDid,
  didKeyFromCompressed,
  encodeSigningPayload,
  verifyOpSignature,
  type Operation,
  type UnsignedOperation,
} from "../../src/accounts/core/index.js";
import type { SdkConfig } from "../../src/accounts/config.js";
import type { Signer } from "../../src/accounts/signers/types.js";

export type VectorCase = {
  name: string;
  did: string;
  cid: string;
  unsigned: UnsignedOperation;
  sig: string;
  signerDidKey: string;
  signerPrivateKeyHex: string;
  payloadHex: string;
};

export const cases = vectors.cases as unknown as VectorCase[];
export const vector = (name: string): VectorCase =>
  cases.find((c) => c.name === name)!;
/** A vector operation with Go's real signature. */
export const signedVector = (name: string): Operation => ({
  ...vector(name).unsigned,
  sig: vector(name).sig,
});

/**
 * The vectors' chain: genesis-wallet-r1-signing -> update-add-device ->
 * update-remove-device -> tombstone, all signed by the vector wallet (priv 0x11..11).
 */
export const VECTOR_CHAIN_DID = vector("genesis-wallet-r1-signing").did;
export const vectorChain = (): Operation[] =>
  [
    "genesis-wallet-r1-signing",
    "update-add-device",
    "update-remove-device",
    "tombstone",
  ].map(signedVector);

const b64u = (b: Uint8Array): string => base64url.encode(b).replace(/=+$/, "");

/** A secp256k1 Signer (default: the vectors' wallet key). `sign` is a vi.fn spy. */
export function k1Signer(
  privHex = cases[0]!.signerPrivateKeyHex,
): Signer & {
  sign: ReturnType<typeof vi.fn<(p: Uint8Array) => Promise<string>>>;
} {
  const priv = hexToBytes(privHex);
  const didKey = didKeyFromCompressed(
    "secp256k1",
    secp256k1.getPublicKey(priv, true),
  );
  const sign = vi.fn(async (payload: Uint8Array) =>
    b64u(secp256k1.sign(sha256(payload), priv, { prehash: false })),
  );
  return { didKey, sign };
}

export const cfgFor = (over: Partial<SdkConfig> = {}): SdkConfig => ({
  accountsUrl: "https://accounts.test",
  dauthUrl: "https://dauth.test",
  directoryUrl: "https://dir.test",
  turnkeyParentOrgId: "parent",
  rpcUrls: {},
  ...over,
});

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export type Handler = (url: string, init: RequestInit) => Promise<Response>;

/** A vi.fn fetch that routes by URL prefix; unknown URLs throw. */
export function router(routes: Record<string, Handler>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    for (const [base, h] of Object.entries(routes)) {
      if (url.startsWith(base)) return h(url, init ?? {});
    }
    throw new Error(`unexpected request ${url}`);
  });
}

/**
 * A fetch that behaves like a browser's: it throws "Illegal invocation" unless called
 * with `this` undefined or the global object.
 */
export function strictReceiver(inner: typeof fetch): typeof fetch {
  return function (
    this: unknown,
    input: string | URL | Request,
    init?: RequestInit,
  ) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError(
        "Failed to execute 'fetch' on 'Window': Illegal invocation",
      );
    }
    return inner(input, init);
  } as typeof fetch;
}

type LogEntry = {
  did: string;
  cid: string;
  operation: Operation;
  createdAt: string;
};

/** In-memory did-directory applying internal/handlers/submit.go's rules. */
export class FakeDirectory {
  readonly base: string;
  readonly logs = new Map<string, LogEntry[]>();
  /** Rewrites the audit log returned by reads (the stored log is untouched). */
  tamper?: (entries: LogEntry[]) => unknown;
  /** Called before each submit is applied; may return a response to send instead. */
  beforeSubmit?: (did: string, op: Operation) => Response | undefined;
  readonly submitted: Operation[] = [];

  constructor(base = "https://dir.test") {
    this.base = base;
  }

  seed(did: string, ops: Operation[]): void {
    this.logs.set(
      did,
      ops.map((operation) => ({
        did,
        cid: computeCid(operation),
        operation,
        createdAt: "2026-11-18T00:00:00Z",
      })),
    );
  }

  /** Seed a wallet-signed genesis; returns the DID. */
  async seedGenesis(
    wallet: Signer,
    extra: { signingKey?: string; alias?: string } = {},
  ): Promise<string> {
    const genesis = buildGenesis({ walletKey: wallet.didKey, ...extra });
    const did = deriveDid(genesis);
    this.seed(did, [
      { ...genesis, sig: await wallet.sign(encodeSigningPayload(genesis)) },
    ]);
    return did;
  }

  /** Append a wallet-signed update built from the current head. */
  async append(
    did: string,
    wallet: Signer,
    patch: (head: UnsignedOperation, cid: string) => UnsignedOperation,
  ): Promise<string> {
    const log = this.logs.get(did)!;
    const last = log.at(-1)!;
    const op = patch(last.operation, last.cid);
    const signed = { ...op, sig: await wallet.sign(encodeSigningPayload(op)) };
    const cid = computeCid(signed);
    log.push({ did, cid, operation: signed, createdAt: "t" });
    return cid;
  }

  head(did: string): LogEntry {
    return this.logs.get(did)!.at(-1)!;
  }

  readonly fetch: Handler = async (url, init) => {
    const rest = url.slice(this.base.length + 1);
    const did = rest.split("/")[0]!;
    const log = this.logs.get(did);
    if (rest.endsWith("/log/audit")) {
      if (!log) return json({ error: "DID not found" }, 404);
      const out = structuredClone(log);
      return json(this.tamper ? this.tamper(out) : out);
    }
    if ((init.method ?? "GET") === "POST") {
      const op = JSON.parse(init.body as string) as Operation;
      const early = this.beforeSubmit?.(did, op);
      if (early) return early;
      this.submitted.push(op);
      return this.apply(did, op);
    }
    if (!log) return json({ error: "DID not found" }, 404);
    const last = log.at(-1)!.operation;
    if (last.type === "plc_tombstone")
      return json({ error: `DID ${did} has been deactivated` }, 410);
    return json({
      "@context": [],
      id: did,
      alsoKnownAs: last.alsoKnownAs,
      verificationMethod: [],
    });
  };

  /** Apply a submitted op under Go's rules and return the directory's response. */
  apply(did: string, op: Operation): Response {
    const payload = encodeSigningPayload(op);
    const signedBy = (keys: string[]) =>
      keys.some((k) => verifyOpSignature(payload, op.sig, k));
    const log = this.logs.get(did);
    const cid = computeCid(op);
    if (!log) {
      if (op.type !== "plc_operation" || op.prev !== null)
        return json({ error: "invalid create operation" }, 400);
      if (deriveDid(op) !== did)
        return json(
          { error: "DID mismatch: derived DID does not match URL" },
          400,
        );
      if (!signedBy(op.rotationKeys))
        return json({ error: "invalid signature" }, 400);
      this.seed(did, [op]);
      return json({ did, cid });
    }
    if (op.prev === null)
      return json(
        {
          error:
            "invalid update operation: update operation must reference a previous CID",
        },
        400,
      );
    const current = log.at(-1)!;
    if (current.operation.type === "plc_tombstone")
      return json(
        { error: "invalid transition: DID has been deactivated" },
        400,
      );
    if (op.prev !== current.cid)
      return json(
        {
          error: "prev CID does not match current head",
          expected: current.cid,
        },
        409,
      );
    if (!signedBy(current.operation.rotationKeys))
      return json({ error: "invalid signature" }, 400);
    log.push({ did, cid, operation: op, createdAt: "t" });
    return json({ did, cid });
  }
}

/** A dauth that issues a challenge for whatever was asked and a token granting `granted` (default: the request's scope). */
export function fakeDauth(opts: { granted?: string | null } = {}): Handler {
  let asked = "";
  return async (url, init) => {
    const b = JSON.parse(init.body as string);
    if (url.endsWith("/signin/challenge")) {
      asked = b.scope;
      const canonical = ["read", "write", "approve"]
        .filter((s) => b.scope.split(" ").includes(s))
        .join(" ");
      return json({
        nonce: "n1",
        challenge: `dimo.org wants you to sign in as\n${b.did}\n\nFor: ${(b.audience ?? []).join(", ")}\nScope: ${canonical}\nKey: ${b.jkt}\n\nNonce: n1\nIssued At: a\nExpiration Time: b`,
      });
    }
    if (url.endsWith("/signin/token")) {
      const granted = opts.granted === undefined ? asked : opts.granted;
      return json({
        token: "jwt",
        token_type: "DPoP",
        expires_in: 600,
        ...(granted === null ? {} : { scope: granted }),
      });
    }
    return json({ error: "not_found" }, 404);
  };
}
