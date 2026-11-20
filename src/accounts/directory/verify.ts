import {
  computeCid,
  deriveDid,
  encodeSigningPayload,
  verifyOpSignature,
  type Operation,
} from "../core/index.js";
import { DirectoryIntegrityError } from "../errors.js";

/** One audit-log entry, after verification. */
export type AuditEntry = {
  did: string;
  cid: string;
  operation: Operation;
  createdAt: string;
};

const OP_FIELDS = new Set([
  "type",
  "rotationKeys",
  "verificationMethods",
  "alsoKnownAs",
  "services",
  "prev",
  "sig",
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Check one entry's shape. Only the canonical person-DID form is accepted: the six
 * signed fields plus `sig`, arrays and maps never null (spec §6.5). Anything else
 * (controlled-asset fields, nulls) cannot be re-encoded to the bytes Go hashed.
 */
function shapeOf(did: string, i: number, raw: unknown): AuditEntry {
  const bad = (why: string): never => {
    throw new DirectoryIntegrityError(did, `audit entry ${i}: ${why}`);
  };
  if (!isObject(raw)) return bad("not an object");
  if (raw.did !== did) bad(`names DID ${JSON.stringify(raw.did)}`);
  if (typeof raw.cid !== "string") bad("cid is not a string");
  if (typeof raw.createdAt !== "string") bad("createdAt is not a string");
  const op = raw.operation;
  if (!isObject(op)) return bad("operation is not an object");
  for (const k of Object.keys(op)) {
    if (!OP_FIELDS.has(k)) bad(`unexpected operation field ${k}`);
  }
  if (op.type !== "plc_operation" && op.type !== "plc_tombstone")
    bad(`unexpected operation type ${JSON.stringify(op.type)}`);
  if (!isStringArray(op.rotationKeys)) bad("rotationKeys is not a string[]");
  if (!isStringArray(op.alsoKnownAs)) bad("alsoKnownAs is not a string[]");
  const vms = op.verificationMethods;
  if (!isObject(vms) || !Object.values(vms).every((v) => typeof v === "string"))
    bad("verificationMethods is not a map of strings");
  const services = op.services;
  if (
    !isObject(services) ||
    !Object.values(services).every(
      (s) =>
        isObject(s) &&
        Object.keys(s).length === 2 &&
        typeof s.type === "string" &&
        typeof s.endpoint === "string",
    )
  )
    bad("services is not a map of {type, endpoint}");
  if (op.prev !== null && typeof op.prev !== "string")
    bad("prev is neither null nor a string");
  if (typeof op.sig !== "string") bad("sig is not a string");
  return {
    did,
    cid: raw.cid as string,
    operation: op as unknown as Operation,
    createdAt: raw.createdAt as string,
  };
}

/**
 * Verify a DID's whole audit log the way did-directory accepted it (internal/handlers
 * submit.go): the genesis is a plc_operation with prev null that derives the DID and is
 * signed by one of its own rotation keys; every later entry's prev is the previous cid
 * and its signature verifies under one of the previous state's rotation keys (any of
 * them, as Go's VerifyOperationSignature); nothing follows a tombstone; and every cid is
 * computeCid(operation). An empty log is not verified: it throws too. Throws DirectoryIntegrityError on the first failure.
 */
export function verifyAuditLog(did: string, raw: unknown[]): AuditEntry[] {
  if (raw.length === 0)
    throw new DirectoryIntegrityError(did, "audit log is empty");
  const entries = raw.map((e, i) => shapeOf(did, i, e));
  entries.forEach((entry, i) => {
    const fail = (why: string, cause?: unknown): never => {
      throw new DirectoryIntegrityError(did, `audit entry ${i}: ${why}`, {
        cause,
      });
    };
    const op = entry.operation;
    let cid = "";
    let payload: Uint8Array = new Uint8Array();
    try {
      cid = computeCid(op);
      payload = encodeSigningPayload(op);
    } catch (cause) {
      fail("operation cannot be encoded", cause);
    }
    if (entry.cid !== cid)
      fail(`cid ${entry.cid} is not the operation's cid ${cid}`);
    let authorized: string[];
    if (i === 0) {
      if (op.type !== "plc_operation" || op.prev !== null)
        fail("genesis must be a plc_operation with prev null");
      if (deriveDid(op) !== did) fail("genesis does not derive this DID");
      authorized = op.rotationKeys;
    } else {
      const before = entries[i - 1]!;
      if (before.operation.type === "plc_tombstone")
        fail("operation after a tombstone");
      if (op.prev !== before.cid)
        fail(`prev ${String(op.prev)} is not entry ${i - 1}'s cid`);
      authorized = before.operation.rotationKeys;
    }
    if (!authorized.some((k) => verifyOpSignature(payload, op.sig, k)))
      fail(
        `signature does not verify under ${i === 0 ? "its own" : "the previous state's"} rotation keys`,
      );
  });
  return entries;
}
