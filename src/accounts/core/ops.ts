import { PolicyError } from "./errors.js";
import { assertPersonDid } from "./policy.js";
import type { UnsignedOperation } from "./types.js";

export function buildGenesis(args: { walletKey: string; signingKey?: string; alias?: string }): UnsignedOperation {
  const verificationMethods: Record<string, string> = {};
  if (args.signingKey) verificationMethods.signing = args.signingKey;
  verificationMethods.wallet = args.walletKey;
  const op: UnsignedOperation = {
    type: "plc_operation",
    rotationKeys: [args.walletKey],
    verificationMethods,
    alsoKnownAs: args.alias ? [args.alias] : [],
    services: {},
    prev: null,
  };
  assertPersonDid(op, args.walletKey);
  return op;
}

function walletOf(head: UnsignedOperation): string {
  const wallet = head.verificationMethods.wallet;
  if (!wallet) throw new PolicyError("wallet_required", "head has no wallet key");
  return wallet;
}

// Builders never repair a non-conforming head: it must already satisfy the policy.
function assertHead(head: UnsignedOperation): string {
  const wallet = walletOf(head);
  assertPersonDid(head, wallet);
  return wallet;
}

function next(head: UnsignedOperation, prevCid: string, patch: Partial<UnsignedOperation>): UnsignedOperation {
  const wallet = assertHead(head);
  const op: UnsignedOperation = {
    type: "plc_operation",
    rotationKeys: [...head.rotationKeys],
    verificationMethods: { ...head.verificationMethods },
    alsoKnownAs: [...head.alsoKnownAs],
    services: {},
    prev: prevCid,
    ...patch,
  };
  assertPersonDid(op, wallet);
  return op;
}

function freeFragment(vms: Record<string, string>): string {
  if (!Object.hasOwn(vms, "signing")) return "signing";
  let n = 2;
  while (Object.hasOwn(vms, `device-${n}`)) n++;
  return `device-${n}`;
}

export function buildAddKey(
  head: UnsignedOperation,
  prevCid: string,
  didKey: string,
  fragment?: string
): { op: UnsignedOperation; fragment: string } {
  assertHead(head);
  const frag = fragment ?? freeFragment(head.verificationMethods);
  if (Object.hasOwn(head.verificationMethods, frag)) {
    throw new PolicyError("fragment_invalid", `fragment already exists: ${frag}`);
  }
  const op = next(head, prevCid, {
    verificationMethods: { ...head.verificationMethods, [frag]: didKey },
  });
  return { op, fragment: frag };
}

export function buildRemoveKey(head: UnsignedOperation, prevCid: string, fragment: string): UnsignedOperation {
  assertHead(head);
  if (fragment === "wallet") throw new PolicyError("wallet_required", "the wallet key cannot be removed");
  if (!Object.hasOwn(head.verificationMethods, fragment)) {
    throw new PolicyError("fragment_invalid", `no such fragment: ${fragment}`);
  }
  const rest = { ...head.verificationMethods };
  delete rest[fragment];
  return next(head, prevCid, { verificationMethods: rest });
}

export function buildSetAliases(head: UnsignedOperation, prevCid: string, aliases: string[]): UnsignedOperation {
  return next(head, prevCid, { alsoKnownAs: [...aliases] });
}

export function buildTombstone(prevCid: string): UnsignedOperation {
  return {
    type: "plc_tombstone",
    rotationKeys: [],
    verificationMethods: {},
    alsoKnownAs: [],
    services: {},
    prev: prevCid,
  };
}

export const SIGNUP_POP_MESSAGE = (email: string, didKey: string): string =>
  `DIMO accounts v2 signup\nemail: ${email}\nkey: ${didKey}`;
