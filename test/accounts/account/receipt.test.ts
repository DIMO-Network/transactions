import { type Hex, zeroAddress } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { describe, expect, it, vi } from "vitest";

import { waitForUserOperationReceipt } from "../../../src/accounts/account/receipt.js";
import { generateDpopKey } from "../../../src/accounts/auth/dpop.js";
import type { Session } from "../../../src/accounts/auth/signin.js";
import type { SdkConfig } from "../../../src/accounts/config.js";
import { UsageError, UserOperationPendingError, UserOperationRevertedError } from "../../../src/accounts/errors.js";

const CHAIN_ID = 80002;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const TX = `0x${"cd".repeat(32)}` as Hex;

async function session(scopes: Session["scopes"] = ["read", "write"]): Promise<Session> {
  return {
    did: "did:key:z",
    token: "tok",
    expiresAt: new Date(Date.now() + 60_000),
    dpopKey: await generateDpopKey(),
    scopes,
  };
}

const receipt = (success: boolean) => ({
  userOpHash: HASH,
  entryPoint: entryPoint07Address,
  sender: zeroAddress,
  nonce: "0x0",
  actualGasUsed: "0x1",
  actualGasCost: "0x1",
  success,
  ...(success ? {} : { reason: "0x08c379a0" }),
  logs: [],
  receipt: {
    transactionHash: TX,
    transactionIndex: "0x0",
    blockHash: `0x${"ef".repeat(32)}`,
    blockNumber: "0x1",
    from: zeroAddress,
    to: zeroAddress,
    cumulativeGasUsed: "0x1",
    gasUsed: "0x1",
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"00".repeat(256)}`,
    status: success ? "0x1" : "0x0",
    effectiveGasPrice: "0x1",
    type: "0x2",
  },
});

/** A proxy answering eth_getUserOperationReceipt with `answers(n)` on the n-th request. */
function proxy(answers: (n: number) => unknown | Response) {
  const requests: { url: string; headers: Headers; body: { method: string; params: unknown[] } }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(input), headers: new Headers(init?.headers), body });
    const answer = answers(requests.length);
    if (answer instanceof Response) return answer;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const cfg: SdkConfig = {
    accountsUrl: "https://accounts.test/",
    dauthUrl: "https://dauth.test",
    directoryUrl: "https://dir.test",
    turnkeyParentOrgId: "org",
    rpcUrls: {},
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { cfg, requests };
}

describe("waitForUserOperationReceipt", () => {
  it("returns the transaction hash of an included op, through the provider's proxy path", async () => {
    const { cfg, requests } = proxy(() => receipt(true));
    const r = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "gelato",
      userOpHash: HASH,
    });
    expect(r).toEqual({ transactionHash: TX });
    expect(requests[0]!.url).toBe(`https://accounts.test/api/v2/bundler/${CHAIN_ID}/gelato`);
    expect(requests[0]!.body).toMatchObject({ method: "eth_getUserOperationReceipt", params: [HASH] });
  });

  it("polls until the receipt appears", async () => {
    const { cfg, requests } = proxy((n) => (n < 2 ? null : receipt(true)));
    const r = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    });
    expect(r.transactionHash).toBe(TX);
    expect(requests.length).toBe(2);
  });

  it("throws UserOperationRevertedError when the op reverted", async () => {
    const { cfg } = proxy(() => receipt(false));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "pimlico",
      userOpHash: HASH,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UserOperationRevertedError);
    expect(e).toMatchObject({ userOpHash: HASH, provider: "pimlico", reason: "0x08c379a0" });
  });

  it("throws UserOperationPendingError when no receipt appears within timeoutMs", async () => {
    const { cfg, requests } = proxy(() => null);
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
      timeoutMs: 50,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UserOperationPendingError);
    expect(e).toMatchObject({ userOpHash: HASH, provider: "alchemy" });
    expect(requests.length).toBeGreaterThan(0);
  });

  it("sends every request with DPoP authorization and a fresh proof", async () => {
    const { cfg, requests } = proxy((n) => (n < 3 ? null : receipt(true)));
    await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    });
    expect(requests.length).toBe(3);
    for (const r of requests) expect(r.headers.get("authorization")).toBe("DPoP tok");
    const proofs = requests.map((r) => r.headers.get("dpop"));
    expect(proofs.every((p) => !!p)).toBe(true);
    expect(new Set(proofs).size).toBe(3);
  });

  it("needs scope write before any request (the gas proxy requires it for every method)", async () => {
    const { cfg, requests } = proxy(() => receipt(true));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(["read"]),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect(e).toMatchObject({ code: "scope_missing" });
    expect(requests).toHaveLength(0);
  });

  it("keeps polling through a transient failure: 502, then no receipt, then success", async () => {
    const { cfg, requests } = proxy((n) =>
      n === 1 ? new Response("bad gateway", { status: 502 }) : n === 2 ? null : receipt(true)
    );
    const r = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    });
    expect(r).toEqual({ transactionHash: TX });
    expect(requests).toHaveLength(3);
  });

  it("ends at once as Pending, with the cause, on a 401", async () => {
    const { cfg, requests } = proxy(() => new Response('{"error":{"code":"x"}}', { status: 401 }));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UserOperationPendingError);
    expect((e as Error).cause).toBeInstanceOf(Error);
    expect(requests).toHaveLength(1);
  });

  it("ends at once as Pending on a 403", async () => {
    const { cfg, requests } = proxy(() => new Response("{}", { status: 403 }));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UserOperationPendingError);
    expect(requests).toHaveLength(1);
  });

  it("throws Pending with the last error as cause when 5xx lasts past timeoutMs", async () => {
    const { cfg, requests } = proxy(() => new Response("down", { status: 503 }));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
      timeoutMs: 50,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UserOperationPendingError);
    expect((e as Error).cause).toBeInstanceOf(Error);
    expect(requests.length).toBeGreaterThan(0);
  });

  it("keeps polling through a JSON-RPC error answer", async () => {
    const { cfg } = proxy((n) =>
      n === 1
        ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "internal" } }), {
            status: 200,
          })
        : receipt(true)
    );
    const r = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
    });
    expect(r.transactionHash).toBe(TX);
  });

  it.each([0, -1, Number.NaN])("rejects timeoutMs %s with UsageError before any request", async (timeoutMs) => {
    const { cfg, requests } = proxy(() => receipt(true));
    const e = await waitForUserOperationReceipt(cfg, {
      session: await session(),
      chainId: CHAIN_ID,
      provider: "alchemy",
      userOpHash: HASH,
      timeoutMs,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UsageError);
    expect(e).toMatchObject({ code: "timeout_invalid" });
    expect(requests).toHaveLength(0);
  });
});
