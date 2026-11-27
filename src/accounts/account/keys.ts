import type { SdkConfig } from "../config.js";
import {
  assertPersonDid,
  buildAddKey,
  buildRemoveKey,
  buildSetAliases,
  encodeSigningPayload,
  isValidFragment,
  type Operation,
  type UnsignedOperation,
  verifyOpSignature,
} from "../core/index.js";
import { type AuditEntry, type DirectoryClient, directoryFor } from "../directory/client.js";
import { DeactivatedError, HeadMovedError, PolicyError } from "../errors.js";
import type { Signer } from "../signers/types.js";

const MAX_ATTEMPTS = 3;

/** Arguments every key change takes. `directory` defaults to cfg.directoryUrl with cfg.fetchImpl. */
export type KeyChangeArgs = {
  did: string;
  /** Signs the operation; must be one of the head's rotation keys. */
  wallet: Signer;
  directory?: DirectoryClient;
};

type Step<T> = {
  /** Runs first on every attempt's verified log; throws to refuse the change. */
  guard?: (log: readonly AuditEntry[]) => void;
  /**
   * Already applied on this head? Then return without signing. `log` is the verified
   * audit log the head came from (read once per attempt).
   */
  done?: (head: UnsignedOperation, cid: string, log: readonly AuditEntry[]) => T | undefined;
  build: (head: UnsignedOperation, prevCid: string) => { op: UnsignedOperation; extra: T };
  prove?: (payload: Uint8Array) => Promise<void>;
};

/**
 * Read the verified head, check it against the person-DID policy (assertPersonDid with the
 * wallet), then build, sign with the wallet, submit. Retries on HeadMovedError
 * only, re-reading the head each time, for at most MAX_ATTEMPTS attempts in total.
 * Idempotent: if the head already has the change, returns its cid without signing, so a
 * call whose outcome was unknown (NetworkError, DirectoryUnavailableError) can be repeated.
 */
async function change<T>(cfg: SdkConfig, args: KeyChangeArgs, step: Step<T>): Promise<{ cid: string } & T> {
  const directory = directoryFor(cfg, args.directory);
  const { did, wallet } = args;
  for (let attempt = 1; ; attempt++) {
    // One verified read gives both the head and the log (DirectoryClient.head() is the
    // last entry of this same log, so reading it separately would fetch the log twice).
    const log = await directory.auditLog(did);
    const last = log.at(-1)!;
    if (last.operation.type === "plc_tombstone") throw new DeactivatedError(did);
    step.guard?.(log);
    const { cid: prevCid, operation: headOp } = last;
    // Only a rotation key of the head can sign an update: a wrong wallet never signs.
    if (!headOp.rotationKeys.includes(wallet.didKey)) {
      throw new PolicyError("rotation_locked", "wallet is not a rotation key of this DID");
    }
    // Builders copy only the unsigned fields, so the head's sig is not carried over.
    const head: UnsignedOperation = headOp;
    // A head that breaks the person-DID policy is refused before anything else, so a
    // non-conforming head can never count as "already done".
    assertPersonDid(head, wallet.didKey);
    const already = step.done?.(head, prevCid, log);
    if (already !== undefined) return { cid: prevCid, ...already };
    const { op, extra } = step.build(head, prevCid);
    const payload = encodeSigningPayload(op);
    if (step.prove) await step.prove(payload);
    const signed: Operation = { ...op, sig: await wallet.sign(payload) };
    try {
      const { cid } = await directory.submit(did, signed);
      return { cid, ...extra };
    } catch (err) {
      if (err instanceof HeadMovedError && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

/** Have `key` sign `payload` and check the signature verifies under its did:key. */
export async function proveKey(key: Signer, payload: Uint8Array): Promise<void> {
  const proof = await key.sign(payload);
  if (!verifyOpSignature(payload, proof, key.didKey)) {
    throw new PolicyError("proof_invalid", `key ${key.didKey} failed proof of possession`);
  }
}

/**
 * Add a verification key. The new key must co-sign the payload (proof of possession,
 * SDK-side only). If the head already lists newKey, returns that fragment and the head
 * cid without signing.
 *
 * A key that an earlier entry of the verified audit log had, but the head no longer has,
 * was removed: a stale retry of this call must not bring it back. That is refused with
 * PolicyError `key_removed` before anything is signed, unless `allowReAdd` is true.
 */
export async function addDeviceKey(cfg: SdkConfig, args: AddDeviceKeyArgs): Promise<{ cid: string; fragment: string }> {
  return addDeviceKeyGuarded(cfg, args);
}

type AddDeviceKeyArgs = KeyChangeArgs & {
  newKey: Signer;
  fragment?: string;
  /** Add newKey even though an earlier entry of the audit log had it (it was removed). */
  allowReAdd?: boolean;
};

/**
 * addDeviceKey, with `guard` run on every attempt's verified log before anything else
 * (claimDid uses it so #signing is only ever built on a log it accepts). Internal.
 */
export async function addDeviceKeyGuarded(
  cfg: SdkConfig,
  args: AddDeviceKeyArgs,
  guard?: (log: readonly AuditEntry[]) => void
): Promise<{ cid: string; fragment: string }> {
  const { newKey, fragment } = args;
  const has = (vms: Readonly<Record<string, string>>) => Object.entries(vms).find(([, key]) => key === newKey.didKey);
  return change(cfg, args, {
    ...(guard ? { guard } : {}),
    done: (head, prevCid, log) => {
      const existing = has(head.verificationMethods);
      if (existing) return { fragment: existing[0] };
      if (args.allowReAdd === true) return undefined;
      const headIndex = log.findIndex((e) => e.cid === prevCid);
      const earlier = log.slice(0, headIndex === -1 ? log.length : headIndex);
      if (earlier.some((e) => has(e.operation.verificationMethods))) {
        throw new PolicyError("key_removed", "key was removed from this DID; pass allowReAdd to add it again");
      }
      return undefined;
    },
    build: (head, prevCid) => {
      const { op, fragment: frag } = buildAddKey(head, prevCid, newKey.didKey, fragment);
      return { op, extra: { fragment: frag } };
    },
    prove: (payload) => proveKey(newKey, payload),
  });
}

/**
 * Remove a verification key, by fragment only (`device-2`, not `#device-2` and not a full
 * VM id). A fragment that is not in the verified head is `fragment_invalid`, unless an
 * earlier entry of the verified audit log had it: then an earlier removal went through
 * (lost response) and the head cid comes back without signing.
 *
 * Fragments are reused: after removing `signing` an app can add a new key under the same
 * name (the E7 recovery flow does). Apps should therefore pass `key`, the did:key they
 * mean to remove. With `key`, the fragment is removed only while it still holds that key;
 * if it holds another one, a stale retry is refused with PolicyError `fragment_invalid`
 * ("fragment now holds a different key") instead of deleting the new key. The
 * already-removed check then needs the audit log to have had that fragment with that key.
 * Without `key` the fragment alone decides.
 */
export async function removeDeviceKey(
  cfg: SdkConfig,
  args: KeyChangeArgs & { fragment: string; key?: string }
): Promise<{ cid: string }> {
  const { fragment, key } = args;
  // Fail fast, before any network call.
  if (!isValidFragment(fragment))
    throw new PolicyError(
      "fragment_invalid",
      `invalid fragment ${JSON.stringify(fragment)}: pass the fragment only (for example "device-2"), without "#" or a DID`
    );
  if (fragment === "wallet") throw new PolicyError("wallet_required", "the wallet key cannot be removed");
  const holds = (vms: Readonly<Record<string, string>>): boolean =>
    Object.hasOwn(vms, fragment) && (key === undefined || vms[fragment] === key);
  return change(cfg, args, {
    done: (head, prevCid, log) => {
      if (Object.hasOwn(head.verificationMethods, fragment)) {
        if (holds(head.verificationMethods)) return undefined;
        throw new PolicyError("fragment_invalid", "fragment now holds a different key");
      }
      const headIndex = log.findIndex((e) => e.cid === prevCid);
      const earlier = log.slice(0, headIndex === -1 ? log.length : headIndex);
      if (earlier.some((e) => holds(e.operation.verificationMethods))) return {};
      throw new PolicyError("fragment_invalid", `fragment ${JSON.stringify(fragment)} does not exist on this DID`);
    },
    build: (head, prevCid) => ({
      op: buildRemoveKey(head, prevCid, fragment),
      extra: {},
    }),
  });
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * Replace alsoKnownAs (did:ethr:<chainId>:<EIP-55 address> entries). If the head already
 * has the same aliases, in any order, returns the head cid without signing.
 */
export async function setAliases(
  cfg: SdkConfig,
  args: KeyChangeArgs & { aliases: string[] }
): Promise<{ cid: string }> {
  const { aliases } = args;
  return change(cfg, args, {
    done: (head) => (sameSet(head.alsoKnownAs, aliases) ? {} : undefined),
    build: (head, prevCid) => ({
      op: buildSetAliases(head, prevCid, aliases),
      extra: {},
    }),
  });
}
