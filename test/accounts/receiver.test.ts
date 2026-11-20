// C1: browsers throw "Illegal invocation" when fetch is called with `this` set to anything
// but the global. Every module must call cfg.fetchImpl (or the default global fetch) unbound.
import type { TurnkeyClient } from "@turnkey/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimDid } from "../../src/accounts/account/claim.js";
import { deleteAccount } from "../../src/accounts/account/delete.js";
import { addDeviceKey } from "../../src/accounts/account/keys.js";
import { requestEmailCode } from "../../src/accounts/account/login.js";
import { generateDpopKey } from "../../src/accounts/auth/dpop.js";
import { authedFetch } from "../../src/accounts/auth/fetch.js";
import { signIn } from "../../src/accounts/auth/signin.js";
import type { SdkConfig } from "../../src/accounts/config.js";
import { DirectoryClient } from "../../src/accounts/directory/client.js";
import { WebCryptoP256Signer } from "../../src/accounts/signers/webcrypto.js";
import {
  FakeDirectory,
  cfgFor,
  fakeDauth,
  json,
  k1Signer,
  router,
  strictReceiver,
} from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

async function world() {
  const dir = new FakeDirectory();
  const routes = router({
    [dir.base]: dir.fetch,
    "https://dauth.test": fakeDauth(),
    "https://accounts.test": async (_url, init) =>
      init.method === "POST"
        ? json({ codeId: "c1" }, 202)
        : init.method === "PUT"
          ? json({
              did: "did:dimo:x",
              email: "a@b.c",
              emailVerified: true,
              subOrganizationId: "so",
              walletAddress: "0x" + "ab".repeat(20),
              smartAccount: null,
            })
          : new Response(null, { status: 204 }),
  });
  return { dir, strict: strictReceiver(routes as unknown as typeof fetch) };
}

const session = async (did: string, scopes = ["write", "approve"]) => ({
  did,
  token: "t",
  expiresAt: new Date(Date.now() + 60_000),
  scopes,
  dpopKey: await generateDpopKey(),
});

// Each mode yields a cfg whose fetch is the strict one: injected, or the default global.
const modes: [string, (strict: typeof fetch) => SdkConfig][] = [
  ["cfg.fetchImpl", (strict) => cfgFor({ fetchImpl: strict })],
  [
    "the default global fetch",
    (strict) => {
      vi.stubGlobal("fetch", strict);
      return cfgFor();
    },
  ],
];

describe.each(modes)("fetch is called unbound via %s", (_mode, mk) => {
  it("directory", async () => {
    const { dir, strict } = await world();
    const cfg = mk(strict);
    const did = await dir.seedGenesis(k1Signer());
    const c = new DirectoryClient(cfg.directoryUrl, cfg.fetchImpl);
    expect((await c.head(did)).cid).toBe(dir.head(did).cid);
  });

  it("auth: signIn and authedFetch", async () => {
    const { strict } = await world();
    const cfg = mk(strict);
    const s = await signIn(cfg, {
      did: "did:dimo:x",
      signer: await WebCryptoP256Signer.generate(),
      fragment: "wallet",
      scope: ["read"],
      dpopKey: await generateDpopKey(),
    });
    expect(s.token).toBe("jwt");
    const res = await authedFetch(cfg, s)("https://accounts.test/api/v2/me");
    expect(res.status).toBe(204);
  });

  it("login", async () => {
    const { strict } = await world();
    expect(await requestEmailCode(mk(strict), { email: "a@b.c" })).toEqual({
      codeId: "c1",
    });
  });

  it("claim", async () => {
    const { strict } = await world();
    const r = await claimDid(mk(strict), {
      wallet: k1Signer(),
      dpopKey: await generateDpopKey(),
    });
    expect(r.did).toMatch(/^did:dimo:/);
  });

  it("keys", async () => {
    const { dir, strict } = await world();
    const did = await dir.seedGenesis(k1Signer());
    const r = await addDeviceKey(mk(strict), {
      did,
      wallet: k1Signer(),
      newKey: await WebCryptoP256Signer.generate(),
    });
    expect(r.cid).toBe(dir.head(did).cid);
  });

  it("delete", async () => {
    const { dir, strict } = await world();
    const did = await dir.seedGenesis(k1Signer());
    const turnkey = {
      deleteSubOrganization: async () => ({
        activity: { id: "a", status: "ACTIVITY_STATUS_COMPLETED", result: {} },
      }),
    } as unknown as TurnkeyClient;
    const done = await deleteAccount(mk(strict), {
      session: await session(did),
      wallet: k1Signer(),
      turnkeyWithUserStamper: turnkey,
      subOrganizationId: "sub",
      deleteWithoutExport: true,
    });
    expect(done.stepsDone).toEqual(["accounts", "turnkey", "tombstone"]);
  });
});
