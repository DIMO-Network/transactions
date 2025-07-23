import { encodeFunctionData, type Hex } from "viem";
import { Wormhole, chainToChainId, VAA, Network, routes, amount } from "@wormhole-foundation/sdk";
import { NttExecutorRoute, nttExecutorRoute } from "@wormhole-foundation/sdk-route-ntt";
import { KernelAccountClient } from "@zerodev/sdk";
import { Percent } from "@uniswap/sdk-core";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import solana from "@wormhole-foundation/sdk/platforms/solana";
import "@wormhole-foundation/sdk-evm-ntt";
import "@wormhole-foundation/sdk-solana-ntt";

import { addressToBytes32 } from ":core/utils/utils.js";
import { convertToExecutorConfig } from ":core/utils/wormhole.js";
import { getDIMOPriceFromUniswapV3 } from ":core/utils/priceOracle.js";
import { swapToExactPOL } from ":core/swap/swapAndWithdraw.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import type { Call } from ":core/types/common.js";
import type { SupportedWormholeNetworks, SupportedRelayingWormholeNetworks, BridgeInitiateArgs, ChainRpcConfig } from ":core/types/wormhole.js";
import { DINC_ADDRESS } from ":core/constants/dimo.js";
import { APPROVE_TOKENS, NTT_TRANSFER } from ":core/constants/methods.js";
import { abiWormholeNttManager } from ":core/abis/index.js";
import {
  CHAIN_ABI_MAPPING,
  ENV_MAPPING,
  UNISWAP_ARGS_MAPPING,
} from ":core/constants/mappings.js";
import {
  WORMHOLE_ENV_MAPPING,
  WORMHOLE_CHAIN_MAPPING,
  WORMHOLE_NTT_CONTRACTS,
  WORMHOLE_TRANSCEIVER_INSTRUCTIONS,
} from ":core/constants/wormholeMappings.js";

/**
 * Initiates a bridging operation for transferring tokens across different chains using Wormhole.
 *
 * This function prepares and encodes a series of transactions needed to bridge tokens from one chain to another.
 * It handles token approvals, fee calculations, and optional relaying. If relaying is enabled, it also handles
 * swapping DIMO tokens to the native token required for the delivery fee.
 *
 * @param args - The parameters for the bridging operation
 * @param args.sourceChain - The source chain from which tokens will be transferred
 * @param args.destinationChain - The destination chain to which tokens will be transferred
 * @param args.amount - The amount of tokens to bridge
 * @param args.recipientAddress - The address that will receive the tokens on the destination chain
 * @param args.isRelayed - Whether the transfer should be automatically relayed (requires paying a delivery fee)
 * @param args.priceIncreasePercentage - Percentage to increase the quoted delivery price by to avoid underfunding
 * @param args.swapOptions - Options for the token swap when paying relay fees
 * @param args.swapOptions.slippageTolerance - Maximum slippage allowed for the swap (in basis points)
 * @param args.swapOptions.deadline - Deadline for the swap transaction (in seconds since epoch)
 * @param args.rpcUrl - RPC URL for the source chain, required for price quotes and swaps
 * @param client - The KernelAccountClient instance used to execute the transactions
 * @param environment - The environment to use (prod, dev, etc.). Currently only prod is supported
 * @returns A Promise resolving to a hex string of encoded transaction calls ready to be executed
 * @throws Error if the environment is not supported, if no NTT manager is found, or if client account is unavailable
 */
export async function initiateBridging(
  args: BridgeInitiateArgs,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<Hex> {
  try {
    if (environment === "dev" || environment === "development") {
      throw new Error("Development environment is not supported yet for bridging operations");
    }

    const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
    const sourceNttManagerAddress = WORMHOLE_NTT_CONTRACTS[args.sourceChain]?.manager;
    const transactions: Array<Call> = [];

    if (!sourceNttManagerAddress) {
      throw new Error(`No NTT manager address found for ${args.sourceChain}`);
    }

    let transferCallValue = BigInt(0);
    let transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.notRelayed;

    if (args.isRelayed) {
      const uniswapArgs = UNISWAP_ARGS_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD];

      // Calculate the delivery price in native tokens
      transferCallValue = await quoteDeliveryPrice(
        args.sourceChain as SupportedRelayingWormholeNetworks,
        args.destinationChain,
        environment,
        args.rpcConfig,
        args.amount,
        args.priceIncreasePercentage
      );

      const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[args.sourceChain];
      const rpcUrl = args.rpcConfig[mappedSourceChain as keyof ChainRpcConfig]?.rpc;
      if (!rpcUrl) {
        throw new Error(`No RPC URL available for ${mappedSourceChain}`);
      }

      // Swap DIMO to exact POL amount needed for the delivery fee
      const swapTransactions = await swapToExactPOL(
        uniswapArgs.dimoToken,
        transferCallValue,
        uniswapArgs.poolFee,
        {
          recipient: client.account?.address as Hex,
          slippageTolerance: new Percent(args.swapOptions?.slippageTolerance || 100, 10_000), // Default 1% slippage tolerance
          deadline: args.swapOptions?.deadline || Math.floor(Date.now() / 1000) + 900, // Default 15 minutes
        },
        rpcUrl,
        true // Include approval for max uint256 (will reset to 0 after)
      );

      // Add swap transactions to the beginning of the transaction array
      transactions.push(...swapTransactions);

      transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.relayed;
    }

    // Add token approval for the bridge
    const approveCall = {
      to: contracts[ContractType.DIMO_TOKEN].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_TOKEN].abi,
        functionName: APPROVE_TOKENS,
        args: [sourceNttManagerAddress, args.amount],
      }),
    };
    transactions.push(approveCall);

    if (!client.account?.address) {
      throw new Error("Client account address is not available");
    }

    // Add the bridge transfer call
    const transferCall = {
      to: sourceNttManagerAddress as Hex,
      value: transferCallValue,
      data: encodeFunctionData({
        abi: abiWormholeNttManager,
        functionName: NTT_TRANSFER,
        args: [
          args.amount,
          chainToChainId(WORMHOLE_CHAIN_MAPPING[args.destinationChain]),
          addressToBytes32(args.recipientAddress),
          addressToBytes32(DINC_ADDRESS), // Refund excess fees
          false,
          transceiverInstructions,
        ],
      }),
    };
    transactions.push(transferCall);

    return await client.account!.encodeCalls(transactions);
  } catch (error) {
    console.error("Error in initiateBridging:", error);
    throw error;
  }
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
 * @param rpcConfig - Configuration object containing RPC URLs for the chains involved.
 * @param amountTokens - The amount of tokens to bridge.
 * @param priceIncreasePercentage - Percentage to increase the quoted delivery price by to avoid underfunding. Defaults to 1%.
 * @param returnInDIMO - Whether to return the price in DIMO tokens instead of native tokens. Only works for Polygon source chain. Defaults to false.
 * @returns A Promise resolving to the delivery price as a bigint, either in native tokens or DIMO tokens based on returnInDIMO parameter.
 * @throws Error if the environment is not supported, if no RPC URL is provided for the source chain, or if converting to DIMO is requested for a non-Polygon source chain.
 */
export async function quoteDeliveryPrice(
  sourceChain: SupportedRelayingWormholeNetworks,
  destinationChain: SupportedWormholeNetworks,
  environment: string = "prod",
  rpcConfig: ChainRpcConfig,
  amountTokens: bigint,
  priceIncreasePercentage: number = 1,
  returnInDIMO: boolean = false
): Promise<bigint> {
  const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[sourceChain];

  // Validate that we have an RPC URL for the source chain
  if (!rpcConfig[mappedSourceChain as keyof ChainRpcConfig]) {
    throw new Error(`No RPC URL provided for ${mappedSourceChain}`);
  }

  const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Mainnet";
  const wh = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform], {
    chains: rpcConfig,
  });

  const srcChain = wh.getChain(mappedSourceChain);
  const destChain = wh.getChain(WORMHOLE_CHAIN_MAPPING[destinationChain]);

  const srcNtt = await srcChain.getProtocol("Ntt", {
    ntt: WORMHOLE_NTT_CONTRACTS[sourceChain],
  });

  const executorRoute = nttExecutorRoute(convertToExecutorConfig(WORMHOLE_NTT_CONTRACTS));
  const routeInstance = new executorRoute(wh);

  const transferRequest = await routes.RouteTransferRequest.create(wh, {
    source: Wormhole.tokenId(srcChain.chain, WORMHOLE_NTT_CONTRACTS[sourceChain]!.token),
    destination: Wormhole.tokenId(destChain.chain, WORMHOLE_NTT_CONTRACTS[destinationChain]!.token),
  });

  // Validate parameters
  const validated = await routeInstance.validate(transferRequest, {
    amount: amount.fmt(amountTokens, await srcNtt.getTokenDecimals()),
  });
  if (!validated.valid) {
    throw new Error(`Quote delivery price validation failed: ${validated.error.message}`);
  }

  // Get quote from route
  const validatedParams: NttExecutorRoute.ValidatedParams = validated.params as NttExecutorRoute.ValidatedParams;
  const routeQuote = await routeInstance.fetchExecutorQuote(transferRequest, validatedParams);

  // Increase price by the specified percentage to avoid underfunding
  const price = (routeQuote.estimatedCost * BigInt(priceIncreasePercentage)) / BigInt(100);

  if (returnInDIMO) {
    // Check if source chain is Polygon, as Uniswap price queries are only supported on Polygon
    if (!sourceChain.includes("Polygon")) {
      throw new Error("Converting price to DIMO tokens is only supported when source chain is Polygon");
    }

    const rpcUrl = rpcConfig[mappedSourceChain as keyof ChainRpcConfig]?.rpc;
    if (!rpcUrl) {
      throw new Error(`No RPC URL available for ${mappedSourceChain}`);
    }

    // Convert price to DIMO tokens
    const dimoPrice = await getDIMOPriceFromUniswapV3(environment, rpcUrl);
    const priceInDIMO = (price * dimoPrice) / BigInt(1e18);
    return priceInDIMO;
  }

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
  if (environment === "dev" || environment === "development") {
    throw new Error("Development environment is not supported yet for bridging operations");
  }

  const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Mainnet";
  const wh = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform]);

  try {
    // Try to fetch the VAA without specifying the payload type
    const vaa = await wh.getVaa(txid, "Uint8Array", timeoutMs);

    if (vaa) {
      return { status: "Completed", vaa };
    } else {
      // If no VAA is found, the transfer is still in progress
      return { status: "In Progress", vaa: null };
    }
  } catch (error) {
    // Check if the error is related to the payload type
    if (error instanceof Error && error.message.includes("No layout registered for payload type")) {
      // If it's a payload type error, assume the transfer is completed
      return { status: "Completed", vaa: null };
    }
    console.error("Error checking NTT transfer status:", error);
    return { status: "Error", vaa: null };
  }
}
