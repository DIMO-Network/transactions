import { createPublicClient, getAddress, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  deploySmartAccount,
  generateDpopKey,
  getMe,
  authedFetch,
} from "../src/index.js";
import {
  CHAIN_ID,
  accountsApi,
  check,
  eq,
  signInWith,
  signup,
  type Ctx,
  type Scenario,
} from "./harness.js";
import { turnkeyViemAccount } from "./turnkey-viem.js";

const ENTRY_POINT_07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

async function hasCode(ctx: Ctx, address: string): Promise<boolean> {
  const client = createPublicClient({ transport: http(ctx.env.RPC_URL_80002) });
  const code = await client.getCode({ address: address as `0x${string}` });
  return !!code && code !== "0x";
}

/**
 * E10. Smart accounts.
 * Passes when: at signup with a coSigner the kernel is deployed, with the alias in the
 * genesis; after signup through the proxy (plain kernel) it is deployed and GET /me shows
 * smartAccount; a UserOp whose sender isn't the caller's kernel gets 403.
 */
export const e10: Scenario = {
  id: "E10",
  title: "smart accounts",
  async run(ctx) {
    // (a) At signup with a coSigner.
    const coSigner = privateKeyToAccount(generatePrivateKey()).address;
    const shared = await signup(ctx, "e10a", {
      device: false,
      smartAccount: { chain: "POLYGON", coSigner },
    });
    const me = await getMe(ctx.cfg, {
      session: await signInWith(ctx, shared.did, shared.wallet, "wallet", [
        "read",
      ]),
    });
    check(me?.smartAccount, "signup with a coSigner returned no smartAccount");
    const sharedAddress = getAddress(me.smartAccount.address);
    check(
      await hasCode(ctx, sharedAddress),
      `the coSigner kernel ${sharedAddress} has no code on chain`,
    );
    const genesis = (await ctx.directory.auditLog(shared.did))[0]!.operation;
    check(
      genesis.alsoKnownAs.includes(`did:ethr:${CHAIN_ID}:${sharedAddress}`),
      `the genesis alias did:ethr:${CHAIN_ID}:${sharedAddress} is missing (alsoKnownAs=${JSON.stringify(genesis.alsoKnownAs)})`,
    );

    // (b) After signup, deployed through the gas proxy (plain kernel).
    const plain = await signup(ctx, "e10b", { device: false });
    const session = await signInWith(
      ctx,
      plain.did,
      plain.wallet,
      "wallet",
      ["read", "write"],
      await generateDpopKey(),
    );
    const { address } = await deploySmartAccount(ctx.cfg, {
      session,
      walletViemAccount: turnkeyViemAccount(
        plain.turnkey,
        plain.subOrganizationId,
        plain.walletAddress,
      ),
      chainId: CHAIN_ID,
      providers: [ctx.env.gasProvider],
    });
    check(
      await hasCode(ctx, address),
      `the plain kernel ${address} has no code on chain`,
    );
    const meAfter = await getMe(ctx.cfg, { session });
    check(
      meAfter?.smartAccount,
      "GET /me shows no smartAccount after the proxy deploy",
    );
    eq(
      meAfter.smartAccount.address.toLowerCase(),
      address.toLowerCase(),
      "GET /me smartAccount address",
    );

    // (c) A UserOp for somebody else's sender is refused.
    const res = await authedFetch(ctx.cfg, session)(
      `${accountsApi(ctx)}/bundler/${CHAIN_ID}/${ctx.env.gasProvider}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendUserOperation",
          params: [
            {
              sender: privateKeyToAccount(generatePrivateKey()).address,
              nonce: "0x0",
              callData: "0x",
            },
            ENTRY_POINT_07,
          ],
        }),
      },
    );
    const refusal = await res.text();
    eq(res.status, 403, "UserOp with a foreign sender: status");
    check(
      /"code"\s*:\s*"forbidden"/.test(refusal) &&
        /not your account/.test(refusal),
      `403 is not the sender-ownership refusal: ${refusal.slice(0, 160)}`,
    );
    return `coSigner kernel ${sharedAddress} deployed with alias; plain kernel ${address} deployed and in GET /me; foreign sender 403`;
  },
};
