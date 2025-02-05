import {
  Account,
  Address,
  Chain,
  ParseAccount,
  PublicClient,
  RpcSchema,
  TransactionRequest,
  Transport,
  WalletClient,
  encodeFunctionData,
} from "viem";
import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";
import { Chain as WChain, encoding } from "@wormhole-foundation/sdk";
import { ContractType, ENVIRONMENT, _kernelConfig } from ":core/types/dimo.js";
import { SEND_DIMO_TOKENS } from ":core/constants/methods.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { SendDIMOTokens } from ":core/types/args.js";
import { TransactionId, Wormhole, amount, signSendWait } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import solana from "@wormhole-foundation/sdk/platforms/solana";
import base from "@wormhole-foundation/sdk/platforms/base";

export function sendDIMOTokensCallData(args: SendDIMOTokens, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_TOKEN].abi,
    functionName: SEND_DIMO_TOKENS,
    args: [args.recipient, args.amount],
  });
}

export async function bridgeTokens(
  args: SendDIMOTokens,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const wh = new Wormhole("Testnet", [evm.Platform, solana.Platform]);
  const src = wh.getChain("BaseSepolia");
  const dst = wh.getChain("Solana");

  // TODO: are we assuming the signer will always be on polygon if they're using the sdk?
  const srcSigner = {
    chain: client.chain!,
    signer: client.account,
    address: Wormhole.chainAddress(src.chain, client.account?.address! as string),
  };
  const dstSigner = {
    chain: client.chain!,
    signer: client.account,
    address: Wormhole.chainAddress(dst.chain, client.account?.address! as string),
  };

  const srcNtt = await src.getProtocol("Ntt", {
    ntt: TEST_NTT_TOKENS[src.chain],
  });
  const dstNtt = await dst.getProtocol("Ntt", {
    ntt: TEST_NTT_TOKENS[dst.chain],
  });

  //   const amt = amount.units(amount.parse("7", await srcNtt));

  const xfer = () =>
    srcNtt.transfer(srcSigner.address.address, 0, dstSigner.address, {
      queue: false,
      automatic: false,
      gasDropoff: BigInt(0),
    });

  // Initiate the transfer (or set to recoverTxids to complete transfer)
  const txids: TransactionId[] = await signSendWait(src, xfer(), srcSigner.signer);
  console.log("Source txs", txids);

  const vaa = await wh.getVaa(txids[txids.length - 1]!.txid, "Ntt:WormholeTransfer", 25 * 60 * 1000);
  console.log(vaa);

  const dstTxids = await signSendWait(dst, dstNtt.redeem([vaa!], dstSigner.address.address), dstSigner.signer);
  console.log("dstTxids", dstTxids);

  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_TOKEN].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_TOKEN].abi,
        functionName: SEND_DIMO_TOKENS,
        args: [args.recipient, args.amount],
      }),
    },
  ]);
}

export type NttContracts = {
  [key in WChain]?: Ntt.Contracts;
};

export const TEST_NTT_TOKENS: NttContracts = {
  Solana: {
    token: "5trJHKSB7M6w1sC74YkxZb5D7GxA9bL6WzP4ht8FDs5V",
    manager: "NTueGPu3ckEwiQXprSjAfHC7YybrJNAG39X2AKEG9So",
    transceiver: {
      wormhole: "NTueGPu3ckEwiQXprSjAfHC7YybrJNAG39X2AKEG9So",
    },
  },
  BaseSepolia: {
    token: "0xaBc1234567890fDb48D63F11dFdc364201C9DE67",
    manager: "0xD456789a1230Cc48fDb48D63F11dFdc364201C9DE",
    transceiver: { wormhole: "0x9876aBcDeF01234567890Fdb48D63F11dFdc3642" },
  },
};
