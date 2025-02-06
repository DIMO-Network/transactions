import { encodeFunctionData } from "viem";
import { Wormhole, chainToChainId, VAA, Network } from "@wormhole-foundation/sdk";
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

/**
 * Initiates a bridging operation for transferring tokens across different chains using Wormhole.
 * 
 * @param args - An object containing the bridging parameters.
 * @param args.sourceChain - The source chain for the bridging operation.
 * @param args.destinationChain - The destination chain for the bridging operation.
 * @param args.tokenAddress - The address of the token to be bridged.
 * @param args.amount - The amount of tokens to be bridged.
 * @param args.recipientAddress - The address of the recipient on the destination chain.
 * @param args.isRelayed - Optional. Indicates if the transfer should be relayed.
 * @param args.priceIncreasePercentage - Optional. The percentage to increase the quoted price by.
 * @param client - The KernelAccountClient instance used for transaction execution.
 * @param environment - Optional. The environment to use for the bridging operation. Defaults to "prod".
 * @returns A Promise that resolves to a string representing the encoded calls for the bridging operation.
 */
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

/**
 * Quotes the delivery price for a Wormhole NTT transfer between chains.
 * 
 * This function calculates the cost of transferring tokens from a source chain to a destination chain
 * using Wormhole's NTT (Non-Transferable Token) protocol. It includes an option to increase the quoted
 * price by a specified percentage to avoid underfunding.
 *
 * @param sourceChain - The chain from which the tokens will be transferred.
 * @param destinationChain - The chain to which the tokens will be transferred.
 * @param environment - The environment to use for the price quote. Defaults to "prod".
 * @param priceIncreasePercentage - The percentage by which to increase the quoted price. Defaults to 10%.
 * @returns A Promise that resolves to a bigint representing the quoted delivery price in the smallest unit of the native token.
 */
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

/**
 * Checks the status of a Non-Transferable Token (NTT) transfer using Wormhole.
 * 
 * This function attempts to fetch the Verified Action Approval (VAA) for a given transaction ID.
 * The presence of a VAA indicates that the transfer has been completed.
 *
 * @param txid - The transaction ID of the NTT transfer to check.
 * @param environment - The environment to use for the status check. Defaults to "prod".
 * @param timeoutMs - The timeout in milliseconds for the VAA fetch operation. Defaults to 30000 (30 seconds).
 * @returns A Promise that resolves to an object containing:
 *          - status: A string indicating the transfer status ("Completed", "In Progress", or "Error").
 *          - vaa: The VAA object if the transfer is completed, or null otherwise.
 */
export async function checkNttTransferStatus(
  txid: string,
  environment: string = "prod",
  timeoutMs: number = 30000
): Promise<{ status: string; vaa: VAA | null }> {
  const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Testnet";
  const wormhole = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform]);

  try {
    // Try to fetch the VAA
    const vaa = await wormhole.getVaa(txid, "Ntt:WormholeTransfer", timeoutMs);

    if (vaa) {
      return { status: "Completed", vaa };
    } else {
      // If no VAA is found, the transfer is still in progress
      return { status: "In Progress", vaa: null };
    }
  } catch (error) {
    console.error("Error checking NTT transfer status:", error);
    return { status: "Error", vaa: null };
  }
}