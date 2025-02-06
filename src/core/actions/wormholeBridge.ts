import { encodeFunctionData } from "viem";
import { Wormhole, chainToChainId, Network } from "@wormhole-foundation/sdk";
import { KernelAccountClient } from "@zerodev/sdk";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import solana from "@wormhole-foundation/sdk/platforms/solana";

import { addressToBytes32 } from ":core/utils/utils.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { APPROVE_TOKENS, NTT_TRANSFER } from ":core/constants/methods.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, WORMHOLE_ENV_MAPPING, WORMHOLE_NTT_CONTRACTS, WORMHOLE_TRANSCEIVER_INSTRUCTIONS } from ":core/constants/mappings.js";
import { abiWormholeNttManager } from ":core/abis/WormholeNttManager.js";

export type SupportedSourceChain = 'Ethereum' | 'Polygon' | 'Base';
export type SupportedDestinationChain = SupportedSourceChain | 'Solana';

export interface BridgeInitiateArgs {
  sourceChain: SupportedSourceChain;
  destinationChain: SupportedDestinationChain;
  tokenAddress: string;
  amount: bigint;
  recipientAddress: string;
  isRelayed?: boolean;
  priceIncreasePercentage?: number;
}

export async function initiateBridging(
  args: BridgeInitiateArgs,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<string> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const sourceNttManagerAddress = WORMHOLE_NTT_CONTRACTS[args.sourceChain]?.manager;

  let transferCallValue = BigInt(0);
  let transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.notRelayed;

  if (args.isRelayed) {
    transferCallValue = await quoteDeliveryPrice(args.sourceChain, args.destinationChain, environment, args.priceIncreasePercentage);
    transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.relayed;
  }

  const approveCall = {
    to: contracts[ContractType.DIMO_TOKEN].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_TOKEN].abi,
      functionName: APPROVE_TOKENS,
      args: [sourceNttManagerAddress, args.amount],
    }),
  };

  const transferCall = {
    to: sourceNttManagerAddress as `0x${string}`,
    value: transferCallValue,
    data: encodeFunctionData({
      abi: abiWormholeNttManager,
      functionName: NTT_TRANSFER,
      args: [
        args.amount,
        chainToChainId(args.destinationChain),
        addressToBytes32(args.recipientAddress),
        addressToBytes32(client.account?.address as string),
        false,
        transceiverInstructions
      ],
    }),
  };

  return await client.account!.encodeCalls([approveCall, transferCall]);
}

export async function quoteDeliveryPrice(
  sourceChain: SupportedSourceChain,
  destinationChain: SupportedDestinationChain,
  environment: string = "prod",
  priceIncreasePercentage: number = 10
): Promise<bigint> {
  const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Testnet";
  const wormhole = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform]);

  const srcChain = wormhole.getChain(sourceChain);
  const destChain = wormhole.getChain(destinationChain);

  const srcNtt = await srcChain.getProtocol("Ntt", {
    ntt: WORMHOLE_NTT_CONTRACTS[sourceChain],
  });

  let price = await srcNtt.quoteDeliveryPrice(destChain.chain, {
    queue: false,
    automatic: true
  });

  // Increase price by the specified percentage to avoid underfunding
  price = price + (price * BigInt(priceIncreasePercentage) / BigInt(100));

  return price;
}