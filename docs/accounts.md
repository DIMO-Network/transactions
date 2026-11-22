# Accounts v2

TypeScript SDK for running DIMO accounts non-custodially, shipped as subpath modules of `@dimo-network/transactions`. Node 20+, browsers and React Native. All are ESM and CommonJS, with types for each.

- `@dimo-network/transactions/accounts/core`: pure encoding and verification code. No `@turnkey/*`, `viem`, `@zerodev/*` or `fetch` imports (checked in the build output by `check:dist`, which `npm run build` runs, and restricted in `src/accounts/core` by `.eslintrc.js`).
- `@dimo-network/transactions/accounts/auth`: `signIn`, the DPoP helpers (`generateDpopKey`, `dpopKeyFromKeyPair`, `createDpopProof`, `jwkThumbprint`, `normalizeHtu`), `authedFetch`, `WebCryptoP256Signer`, the `Session`/`Scope`/`SdkConfig`/`Signer` types and the errors they throw. It loads no smart-account, passkey or Turnkey code, so no `viem`, `@zerodev/*` or `@turnkey/*`: an app that only signs in with a device key ships about 90 KB minified instead of about 330 KB.
- `@dimo-network/transactions/accounts/directory`: `DirectoryClient`, `verifyAuditLog` and the directory errors, with the same guarantee.
- `@dimo-network/transactions/accounts`: the `auth` and `directory` exports plus the signers and account flows. It imports `viem`, `@zerodev/sdk`, `@zerodev/ecdsa-validator` and `@turnkey/http` when it loads (all four are dependencies of this package, so they install with it); the three entries above import none of them, so code that only needs them should import those and keep the rest out of its bundle. Every class and function is one shared copy across the entries, so `instanceof` works whichever entry threw.

The package's main entry, `@dimo-network/transactions`, does not re-export any of them, and the accounts modules do not load it.

## Usage

Every network call takes the same config first, then one arguments object: `fn(cfg, args)`, with `session` or `address` as named fields (`getMe(cfg, { session })`, `recordSignIn(cfg, { session, deviceKey })`, `lookupByWallet(cfg, { address })`). Two exceptions: `authedFetch(cfg, session)` returns a fetch function, and `resumeDelete(cfg, pending, opts)` takes the saved `PendingDeletion` as its second argument. `cfg.fetchImpl` is the only fetch the SDK uses (accounts, dauth, the directory and the chain RPC); it defaults to the global fetch and is always called unbound, so `window.fetch` is fine. Base URLs may have trailing slashes.

```ts
import {
  type SdkConfig,
  WebCryptoP256Signer,
  generateDpopKey,
  signIn,
  addDeviceKey,
} from "@dimo-network/transactions/accounts";

const cfg: SdkConfig = {
  accountsUrl: "<accounts base URL>",
  dauthUrl: "<dauth base URL>",
  directoryUrl: "<did-directory base URL>",
  turnkeyParentOrgId: "<Turnkey parent org id>",
  rpcUrls: { 137: "<Polygon RPC URL>" },
};

const device = await WebCryptoP256Signer.generate();
const dpopKey = await generateDpopKey();

// The wallet (a Turnkey signer) adds the device key; the device key co-signs as proof of possession.
await addDeviceKey(cfg, { did, wallet, newKey: device });

// Sign in with the device key. audience defaults to [cfg.accountsUrl].
const session = await signIn(cfg, {
  did,
  signer: device,
  fragment: "signing",
  scope: ["read", "write"],
  dpopKey,
});
session.scopes; // what dauth granted
```

DPoP proofs (`signIn`'s token request, `authedFetch`, `createDpopProof`) normalise `htu` with `normalizeHtu` as did-directory's `pkg/dpop` does (cross-repo contract 4; the shared vectors are `test/accounts/fixtures/htu-vectors.json`): scheme and host lowercased, `:443`/`:80` dropped for https/http, query and fragment dropped, and the path in its percent-encoded form, with no trailing slash added or removed. `htm` is the upper-cased method, which `authedFetch` also sends. Bare-origin URLs (no path, such as `https://example.com`) are unsupported for DPoP. Known divergences from Go that no vector covers: the SDK drops userinfo and Go keeps it; Go escapes `|` in the path and the SDK does not; the SDK (WHATWG) resolves dot segments, reads `\` as `/` and compresses IPv6 hosts, and Go does none of these. Use plain URLs without those forms.

Key changes (`addDeviceKey`, `removeDeviceKey`, `setAliases`) read the directory head, verify its whole audit chain (CIDs, prev links, DID derivation, signatures) and only then sign; a tampered head throws `DirectoryIntegrityError` before the wallet is asked. They are idempotent: when the head already has the change they return its cid without signing, so after an unknown outcome (`NetworkError`, `DirectoryUnavailableError`) just call them again.

Fragments are reused (recovery removes `signing` and adds a new device key under the same name), so pass `key` to `removeDeviceKey`: `removeDeviceKey(cfg, { did, wallet, fragment: "signing", key: device.didKey })` removes the fragment only while it still holds that did:key. A stale retry after a re-add is refused with `PolicyError` `fragment_invalid` ("fragment now holds a different key") instead of deleting the new key. Without `key` the fragment alone decides. The other way round, `addDeviceKey` will not bring back a key that an earlier entry of the audit log had and the head no longer has: a stale retry after a removal is refused with `PolicyError` `key_removed`, before anything is signed. Pass `allowReAdd: true` to add a removed key again on purpose.

### Account helpers

```ts
import { createAccount, getMe, recordSignIn, lookupByWallet, claimDid } from "@dimo-network/transactions/accounts";

// Sign up (public route). With `signingKey` the SDK signs the proof of possession over
// "DIMO accounts v2 signup\nemail: <trimmed, lowercased>\nkey: <didKey>", verifies it
// locally, and sends { didKey, proof }. 409 is AccountsError code "conflict", or
// LinkRequiredError ("link_required") for an existing v1 account: see below.
const { account, credentialBundle } = await createAccount(cfg, {
  email,
  proof: { codeId, code }, // or { idToken }
  sessionPublicKey,
  signingKey: device,
  smartAccount: { chain: "POLYGON" },
});

// GET /me (scope "read"): the AccountView, or null when accounts has no user.
const me = await getMe(cfg, { session });

// POST /me/sign-ins (scope "write"): record that this device key signed in.
await recordSignIn(cfg, { session, deviceKey: device.didKey });

// GET /accounts/by-wallet/{address} (public): the account's DID, or null.
const did = await lookupByWallet(cfg, { address: walletAddress });
```

`createAccount` answering 409 `link_required` throws `LinkRequiredError` (an `AccountsError`): the email belongs to an existing v1 account that signup can't take over, because its email was never proven or its user is already a root of the sub-org. Don't retry signup. Log in with the account's v1 passkey (`loginWithPasskey`, then a Turnkey signer for its wallet) and call `claimDid`, which creates the DID and links it with `PUT /api/v2/me/did`.

`loginWithEmail` answers an `EmailLoginResult`: the `LoginResult` fields plus `emailVerified` (the account's email was proven) and `otherCredentials` (its sub-org holds a passkey or API key this login did not create). Open signup lets anyone make an account for an email address with their own passkey and signing key, so `emailVerified: false` with `otherCredentials: true` means someone else may already control the wallet and the DID: warn the user, or stop, before they link vehicles or receive funds. An answer without both booleans is `AccountsError` `invalid_response`.

`claimDid` signs in with scopes `read` and `write` (a wider `scope` is allowed, a narrower one is a `UsageError`) and returns `{ did, session, account }`, where `account` is the `AccountView` that `PUT /me/did` answered with. `getMe` and `recordSignIn` fail fast with `UsageError` `scope_missing` before any request when the session lacks the scope. With a `signingKey`, `claimDid` sends `{ signingKey: <its did:key> }` as the `PUT /me/did` body (on every retry too): accounts links a genesis that has `#signing` only when the body names that same key. `claimDid` retries `PUT /me/did` up to 3 times when accounts answers 503 `unavailable` (directory propagation lag), honouring `Retry-After` (default 1 s, capped at 5 s).

Every error is an `AccountSdkError` with a stable `code`; branch on the class or the code, never the message. The SDK's own error classes (`PolicyError`, `UsageError`, `TurnkeyError`, `EncodingError`, `GasProxyError`, `DeleteIncompleteError`) type `code` as a union of literals. `AccountsError.code` stays a `string`: it is the accounts server's own code from its `{error:{code,message}}` envelope, which is open, so new codes can appear without an SDK release. `AccountsError.retryAfterSeconds` is the response's `Retry-After` when it was an integer number of seconds (an HTTP-date is ignored).

`deploySmartAccount` and `sendUserOperation` need a session with scope `write`, and refuse an RPC (`cfg.rpcUrls[chainId]`) whose `eth_chainId` is another chain with `UsageError` `chain_mismatch`, before anything is signed. Each provider attempt prepares the UserOp, signs it and sends it. The gas proxy answering 401, 403 or 429 is about this session, not the provider, so the SDK stops and throws `GasProxyError` (`status`, `provider`, and for 429 `retryAfterSeconds`) instead of trying the next provider. Any other failure before the send (sponsorship, estimation, a 5xx) falls through to the next provider, which prepares and signs again with the same nonce: the SDK reads the EntryPoint nonce once per call, so at most one op per call can ever be included, even when a provider's error looked like a refusal but its bundler took the op. At the send, only a definite refusal falls through: a JSON-RPC error with a numeric code other than `-32603`, or another HTTP 4xx. Every other send failure (a timeout, a network error, a body that cannot be read or parsed, HTTP 5xx, `-32603`), and a 2xx whose `result` is not the op's hash (compared case-insensitively), may have reached the bundler, so it never falls through: the SDK asks the same provider once for the op's hash (computed locally before the send) and returns it if the answer carries the op, else throws `UserOperationUnknownError` (`userOpHash`, `provider`, `nonce`). That lookup can come back empty even when the provider accepted the op (still in flight, or a bundler that indexes only included ops), so the op may still land: poll the receipt for `userOpHash`, or the account's EntryPoint nonce against `nonce`, before sending again. The send waits up to 30 s (longer than the proxy's own 25 s wait for the bundler, so the proxy's 504 arrives first); every other proxy request (sponsorship, gas price, estimation, lookups, receipts) waits 10 s, so a hung call falls through quickly. The proxy transport does not retry on its own.

### Deleting the account

`deleteAccount(cfg, { session, wallet, turnkeyWithUserStamper, subOrganizationId, deleteWithoutExport })` needs a session with scope `approve`, signed in with the wallet (`fragment: "wallet"`): dauth grants `approve` only when the key that signed in is also a rotation key of the DID, and answers any other key with 403 `key_not_allowed`, which `signIn` throws as `KeyNotAllowedError` (a `SigninError`; `fragment` names the key that signed). The SDK never picks another key for you. Before anything is signed or forgotten, it checks that `subOrganizationId` holds an Ethereum account with the wallet's address, else `TurnkeyError` `sub_org_mismatch`: a stamper that reaches other sub-orgs (an org founder's passkey reaches the org's root sub-org) can never delete the wrong one. `resumeDelete` checks the stored sub-org again, and that `pending.walletAddress` is the address of the key that signed the tombstone, whenever the Turnkey step is still to do: before `DELETE /me` when that step is still to do too (so a wrong sub-org makes accounts forget nothing), and otherwise before the Turnkey delete.

A failure after signing throws `DeleteIncompleteError` (or `DeleteHeadMovedError`); its `pending` (a `PendingDeletion`) finishes the deletion through `resumeDelete` without signing again. A `PendingDeletion` is a bearer credential: its `signedTombstone` deactivates the DID for good, for whoever submits it, as long as the head has not moved, even if the user changes their mind. Keep it on the device only (IndexedDB, the platform keystore); never log it or send it to a server or an error reporter. On the error, `pending` is non-enumerable, so `JSON.stringify(err)` and reporters that copy an error's own fields (Sentry's ExtraErrorData) leave it out.

## Persisting keys and the session (browsers)

`WebCryptoP256Signer` and the DPoP key are WebCrypto pairs whose private key is non-extractable. IndexedDB stores `CryptoKey` objects as they are (structured clone) without ever exposing the private key, so persist the pair, not key material:

```ts
import {
  WebCryptoP256Signer,
  dpopKeyFromKeyPair,
  type Session,
  type WebCryptoDpopKey,
} from "@dimo-network/transactions/accounts";

// Save (idb-keyval shown; any IndexedDB wrapper works).
await set("device-key", device.keyPair);
await set("session", {
  did: session.did,
  token: session.token,
  expiresAt: session.expiresAt.toISOString(),
  scopes: session.scopes,
  clockOffsetMs: session.clockOffsetMs,
  dpopKeyPair: (session.dpopKey as WebCryptoDpopKey).keyPair,
});

// Restore after a reload.
const device = await WebCryptoP256Signer.fromKeyPair(await get("device-key"));
const s = await get("session");
const session: Session = {
  did: s.did,
  token: s.token,
  expiresAt: new Date(s.expiresAt),
  scopes: s.scopes,
  clockOffsetMs: s.clockOffsetMs,
  dpopKey: await dpopKeyFromKeyPair(s.dpopKeyPair),
};
if (session.expiresAt.getTime() <= Date.now()) {
  // sign in again with `device`; the DPoP pair can be reused
}
```

The token is bound to the DPoP key's thumbprint (`cnf.jkt`), so a restored token only works with the same pair. `clockOffsetMs` is set when the device clock was 5 s or more off dauth's at sign-in (measured from the challenge's `Issued At`, read only when it is strict RFC 3339; more than 24 h off is `ClockSkewError`, thrown before anything is signed): every DPoP proof for the session adds it to the device clock, so a phone whose clock runs minutes fast or slow still passes the servers' `iat` window. Keep it with the token. localStorage cannot hold a `CryptoKey`; do not export the private key to make it fit. React Native apps implement `Signer` and `DpopKey` over the platform keystore instead.

## Before publishing

Publish this SDK only after the accounts service whose `POST /api/v2/login/email` answers `emailVerified` and `otherCredentials` is deployed to every environment the release targets, dev included. `loginWithEmail` refuses an answer without both booleans (`AccountsError` `invalid_response`), so against an older accounts every email login fails. The same release also relies on that accounts for the `signingKey` body of `PUT /api/v2/me/did` (sent by `claimDid` with a signing key) and for signup's 409 `link_required`.

## Scripts

`npm run build` (tsc for the main entry, then tsup for `dist/accounts`, then `check:dist`), `npm test` (vitest; the accounts tests are in `test/accounts`), `npm run typecheck` (`tsconfig.json`, then `tsconfig.accounts.json` for `src/accounts`, `test/accounts` and `e2e/accounts`).
`npm run check:dist` checks the built output: `dist/accounts/core`, `dist/accounts/auth` and `dist/accounts/directory` (ESM and CJS, with every chunk they load) import no external module; browser bundles of `auth` and `directory` contain no ZeroDev, Turnkey or viem code; and `./accounts` exports the very same values as each of them under both `require` and `import`.
`npm run vectors:sync` copies `testdata/vectors/did-ops.json` from `origin/main` of a `../did-directory` checkout (run `git fetch` there first) to `test/accounts/fixtures/did-ops.json`. It fails, leaving the fixture as it is, until did-directory #30 is on main.
`npm run e2e:accounts` runs the end-to-end suite against dev. It is opt-in and never part of `npm test`; `e2e/accounts/env.example` lists its variables, opt-ins and preconditions.
