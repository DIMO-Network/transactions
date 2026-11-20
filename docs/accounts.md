# @dimo-network/account-sdk

TypeScript SDK for running DIMO accounts non-custodially. Node 20+, browsers and React Native.

- `@dimo-network/account-sdk/core`: pure encoding and verification code. No `@turnkey/*`, `viem`, `@zerodev/*` or `fetch` imports (enforced by ESLint, and in the build output by `check:dist`).
- `@dimo-network/account-sdk`: signers and account flows. `viem`, `@zerodev/sdk`, `@zerodev/ecdsa-validator` and `@turnkey/http` are required peer dependencies: install them alongside (npm 7 and later does so on its own). The main entry imports all four when it loads; `@dimo-network/account-sdk/core` imports none of them, so code that only needs encoding and verification should import `/core` and keep the peers out of its bundle.

## Usage

Every network call takes the same config first, then one arguments object: `fn(cfg, args)`, with `session` or `address` as named fields (`getMe(cfg, { session })`, `recordSignIn(cfg, { session, deviceKey })`, `lookupByWallet(cfg, { address })`). Two exceptions: `authedFetch(cfg, session)` returns a fetch function, and `resumeDelete(cfg, pending, opts)` takes the saved `PendingDeletion` as its second argument. `cfg.fetchImpl` is the only fetch the SDK uses (accounts, dauth, the directory and the chain RPC); it defaults to the global fetch and is always called unbound, so `window.fetch` is fine. Base URLs may have trailing slashes.

```ts
import {
  type SdkConfig,
  WebCryptoP256Signer,
  generateDpopKey,
  signIn,
  addDeviceKey,
} from "@dimo-network/account-sdk";

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

Key changes (`addDeviceKey`, `removeDeviceKey`, `setAliases`) read the directory head, verify its whole audit chain (CIDs, prev links, DID derivation, signatures) and only then sign; a tampered head throws `DirectoryIntegrityError` before the wallet is asked. They are idempotent: when the head already has the change they return its cid without signing, so after an unknown outcome (`NetworkError`, `DirectoryUnavailableError`) just call them again.

Fragments are reused (recovery removes `signing` and adds a new device key under the same name), so pass `key` to `removeDeviceKey`: `removeDeviceKey(cfg, { did, wallet, fragment: "signing", key: device.didKey })` removes the fragment only while it still holds that did:key. A stale retry after a re-add is refused with `PolicyError` `fragment_invalid` ("fragment now holds a different key") instead of deleting the new key. Without `key` the fragment alone decides. The other way round, `addDeviceKey` will not bring back a key that an earlier entry of the audit log had and the head no longer has: a stale retry after a removal is refused with `PolicyError` `key_removed`, before anything is signed. Pass `allowReAdd: true` to add a removed key again on purpose.

### Account helpers

```ts
import {
  createAccount,
  getMe,
  recordSignIn,
  lookupByWallet,
  claimDid,
} from "@dimo-network/account-sdk";

// Sign up (public route). With `signingKey` the SDK signs the proof of possession over
// "DIMO accounts v2 signup\nemail: <trimmed, lowercased>\nkey: <didKey>", verifies it
// locally, and sends { didKey, proof }. 409 is AccountsError code "conflict".
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

`claimDid` signs in with scopes `read` and `write` (a wider `scope` is allowed, a narrower one is a `UsageError`) and returns `{ did, session, account }`, where `account` is the `AccountView` that `PUT /me/did` answered with. `getMe` and `recordSignIn` fail fast with `UsageError` `scope_missing` before any request when the session lacks the scope. `claimDid` retries `PUT /me/did` up to 3 times when accounts answers 503 `unavailable` (directory propagation lag), honouring `Retry-After` (default 1 s, capped at 5 s).

Every error is an `AccountSdkError` with a stable `code`; branch on the class or the code, never the message. The SDK's own error classes (`PolicyError`, `UsageError`, `TurnkeyError`, `EncodingError`, `GasProxyError`, `DeleteIncompleteError`) type `code` as a union of literals. `AccountsError.code` stays a `string`: it is the accounts server's own code from its `{error:{code,message}}` envelope, which is open, so new codes can appear without an SDK release. `AccountsError.retryAfterSeconds` is the response's `Retry-After` when it was an integer number of seconds (an HTTP-date is ignored).

`deploySmartAccount` and `sendUserOperation` need a session with scope `write`, and refuse an RPC (`cfg.rpcUrls[chainId]`) whose `eth_chainId` is another chain with `UsageError` `chain_mismatch`, before anything is signed. Each provider attempt prepares the UserOp, signs it and sends it. The gas proxy answering 401, 403 or 429 is about this session, not the provider, so the SDK stops and throws `GasProxyError` (`status`, `provider`, and for 429 `retryAfterSeconds`) instead of trying the next provider. Any other failure before the send (sponsorship, estimation, a 5xx) falls through to the next provider, which prepares and signs again. At the send, only a definite refusal falls through: a JSON-RPC error with a numeric code other than `-32603`, or another HTTP 4xx. Every other send failure (a timeout, a network error, a body that cannot be read or parsed, HTTP 5xx, `-32603`), and a 2xx whose `result` is not the op's hash (compared case-insensitively), may have reached the bundler, so it never falls through: the SDK asks the same provider once for the op's hash (computed locally before the send) and returns it if the answer carries the op, else throws `UserOperationUnknownError` (`userOpHash`, `provider`, `nonce`). That lookup can come back empty even when the provider accepted the op (still in flight, or a bundler that indexes only included ops), so the op may still land: poll the receipt for `userOpHash`, or the account's EntryPoint nonce against `nonce`, before sending again. The send waits up to 30 s (longer than the proxy's own 25 s wait for the bundler, so the proxy's 504 arrives first); every other proxy request (sponsorship, gas price, estimation, lookups, receipts) waits 10 s, so a hung call falls through quickly. The proxy transport does not retry on its own.

## Persisting keys and the session (browsers)

`WebCryptoP256Signer` and the DPoP key are WebCrypto pairs whose private key is non-extractable. IndexedDB stores `CryptoKey` objects as they are (structured clone) without ever exposing the private key, so persist the pair, not key material:

```ts
import {
  WebCryptoP256Signer,
  dpopKeyFromKeyPair,
  type Session,
  type WebCryptoDpopKey,
} from "@dimo-network/account-sdk";

// Save (idb-keyval shown; any IndexedDB wrapper works).
await set("device-key", device.keyPair);
await set("session", {
  did: session.did,
  token: session.token,
  expiresAt: session.expiresAt.toISOString(),
  scopes: session.scopes,
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
  dpopKey: await dpopKeyFromKeyPair(s.dpopKeyPair),
};
if (session.expiresAt.getTime() <= Date.now()) {
  // sign in again with `device`; the DPoP pair can be reused
}
```

The token is bound to the DPoP key's thumbprint (`cnf.jkt`), so a restored token only works with the same pair. localStorage cannot hold a `CryptoKey`; do not export the private key to make it fit. React Native apps implement `Signer` and `DpopKey` over the platform keystore instead.

## Scripts

`npm run build` (tsup, then `check:dist`), `npm test`, `npm run typecheck`, `npm run lint`.
`npm run check:dist` checks the built output: `dist/core` (ESM and CJS, with every chunk it loads) imports no external module, and the main entry and `./core` export the very same error classes under both `require` and `import`.
`npm run vectors:sync` copies `testdata/vectors/did-ops.json` from the local `feat/v2-prereqs` branch of `../did-directory` (switch to the tag once it exists).

## Turnkey spike

Status: not yet run (no Turnkey API keys on the machine that scaffolded this).

Question: does Turnkey's `SIGN_RAW_PAYLOAD_V2` produce a secp256k1 signature that verifies over `sha256(payload)`? The spike creates a throwaway sub-org with one secp256k1 wallet, signs the `genesis-wallet-only` vector payload, verifies r||s with noble, then deletes the sub-org.

```bash
TURNKEY_API_PUBLIC_KEY=... TURNKEY_API_PRIVATE_KEY=... TURNKEY_ORGANIZATION_ID=<dev parent org> \
  npx tsx spike/turnkey-sha256.ts
# or: npx tsx spike/turnkey-sha256.ts --env /path/to/.env.dev
```

`TURNKEY_BASE_URL` defaults to `https://api.turnkey.com`. Output is `VERIFIED mode=<mode>`, `FAILED <reason>` (Turnkey signing or verification failed), or `INCONCLUSIVE <reason>` (no usable public key, or it did not match the ETH address; says nothing about SHA-256 support). The wallet gets a second ADDRESS_FORMAT_COMPRESSED account so the public key is available even if the ETH account omits it.

Modes tried in order:

1. `sha256-utf8`: `PAYLOAD_ENCODING_TEXT_UTF8` + `HASH_FUNCTION_SHA256` over the payload text.
2. `noop-hex-digest`: `PAYLOAD_ENCODING_HEXADECIMAL` + `HASH_FUNCTION_NO_OP` over the hex SHA-256 digest.

Result: _not yet recorded_. Task 6 uses whichever mode prints VERIFIED. If both fail, the k1 Turnkey path is blocked; report to Yev.
