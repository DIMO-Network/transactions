import { type Hex } from "viem";
import { TransactionDescription } from "ethers";
import { Wormhole, Network, routes, amount, AccountAddress, toUniversal, UniversalAddress } from "@wormhole-foundation/sdk";
import { NttExecutorRoute, nttExecutorRoute } from "@wormhole-foundation/sdk-route-ntt";
import { KernelAccountClient } from "@zerodev/sdk";
import { Percent } from "@uniswap/sdk-core";
import evm from "@wormhole-foundation/sdk/platforms/evm";
import solana from "@wormhole-foundation/sdk/platforms/solana";
import "@wormhole-foundation/sdk-evm-ntt";
import "@wormhole-foundation/sdk-solana-ntt";

import { WormholeScanAPI } from ':core/utils/wormhole/api-client.js';
import { convertToExecutorConfig, getOperationStatus, isWormholeErrorResponse } from ":core/utils/wormhole/helpers.js";
import { getDIMOPriceFromUniswapV3 } from ":core/utils/priceOracle.js";
import { swapToExactPOL } from ":core/swap/swapAndWithdraw.js";
import { ENVIRONMENT } from ":core/types/dimo.js";
import type { Call } from ":core/types/common.js";
import {
  type SupportedWormholeNetworks,
  type SupportedRelayingWormholeNetworks,
  type BridgeInitiateArgs,
  type ChainRpcConfig,
  type Vaa,
  type BaseWormholeResponse
} from ":core/types/wormhole.js";
import {
  ENV_MAPPING,
  UNISWAP_ARGS_MAPPING,
} from ":core/constants/mappings.js";
import {
  REFUND_ADDRESS_MAPPING,
  WORMHOLE_ENV_MAPPING,
  WORMHOLE_CHAIN_MAPPING,
  WORMHOLE_NTT_CONTRACTS
} from ":core/constants/wormholeMappings.js";
import { NttWithExecutor } from "@wormhole-foundation/sdk-definitions-ntt";

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

    // const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
    const sourceNttManagerAddress = WORMHOLE_NTT_CONTRACTS[args.sourceChain]?.manager;
    const transactions: Array<Call> = [];

    if (!sourceNttManagerAddress) {
      throw new Error(`No NTT manager address found for ${args.sourceChain}`);
    }
    if (!client.account?.address) {
      throw new Error("Client account address is not available");
    }

    if (args.isRelayed) {
      let transferSendValue = null;

      if (args.payWithDimo) {
        const uniswapArgs = UNISWAP_ARGS_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD];

        // Calculate the delivery price in native tokens
        transferSendValue = await quoteDeliveryPrice(
          args.sourceChain as SupportedRelayingWormholeNetworks,
          args.destinationChain,
          environment,
          args.rpcConfig,
          args.amount,
          args.priceIncreasePercentage ?? 0
        );

        const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[args.sourceChain];
        const rpcUrl = args.rpcConfig[mappedSourceChain as keyof ChainRpcConfig]?.rpc;
        if (!rpcUrl) {
          throw new Error(`No RPC URL available for ${mappedSourceChain}`);
        }

        // Swap DIMO to exact POL amount needed for the delivery fee
        const swapTransactions = await swapToExactPOL(
          uniswapArgs.dimoToken,
          transferSendValue,
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
      }

      const wormholeTransferTxs = await generateWormholeRelayedTransferTransactions(
        args,
        toUniversal(WORMHOLE_CHAIN_MAPPING[args.sourceChain], client.account.address),
        Wormhole.chainAddress(WORMHOLE_CHAIN_MAPPING[args.destinationChain], args.recipientAddress),
        environment,
        transferSendValue,
        args.priceIncreasePercentage
      )

      transactions.push(...wormholeTransferTxs);
    } else {
      const wormholeTransferTxs = await generateWormholeNonRelayedTransferTransactions(
        args,
        toUniversal(WORMHOLE_CHAIN_MAPPING[args.sourceChain], client.account.address),
        Wormhole.chainAddress(WORMHOLE_CHAIN_MAPPING[args.destinationChain], args.recipientAddress),
        environment
      )

      transactions.push(...wormholeTransferTxs);
    }

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
 * using Wormhole's NTT protocol. It includes an option to increase the quoted price by a specified
 * percentage to avoid underfunding.
 *
 * @param sourceChain - The chain from which the tokens will be transferred.
 * @param destinationChain - The chain to which the tokens will be transferred.
 * @param environment - The environment to use for the price quote. Defaults to "prod".
 * @param rpcConfig - Configuration object containing RPC URLs for the chains involved.
 * @param amountTokens - The amount of tokens to bridge.
 * @param priceIncreasePercentage - Percentage to increase the quoted delivery price by to avoid underfunding. Defaults to 1%. Must be between 0 and 100.
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
  if (priceIncreasePercentage < 0 || priceIncreasePercentage > 100) {
    throw new Error("Price increase percentage must be between 0 and 100");
  }

  const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[sourceChain];

  const routeQuote = await getRouteQuote(
    sourceChain,
    destinationChain,
    environment,
    rpcConfig,
    amountTokens
  )

  // Increase price by the specified percentage to avoid underfunding
  const price = (routeQuote.estimatedCost * BigInt(100 + priceIncreasePercentage)) / BigInt(100);

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
 * This function queries the WormholeScan API to retrieve information about a specific
 * transaction and determine its current status. It handles various error conditions
 * and provides detailed information about the transfer operation.
 *
 * @param txid - The transaction ID (hash) of the NTT transfer to check
 * @param environment - The environment to use for the status check (e.g., "prod", "dev")
 *                      Defaults to "prod" if not specified
 * @returns A Promise that resolves to an object containing:
 *          - status: A string indicating the transfer status
 *            - 'Completed': The operation has reached its destination chain
 *            - 'Emitted': The operation has a VAA but hasn't reached the destination chain
 *            - 'In Progress': The operation has been initiation in the source chain, but no VAA yet
 *            - 'Unknown': The operation doesn't have enough information to determine its status
 *          - vaa: The VAA object if the transfer is completed, or undefined
 *          - error: Error details if the status check failed, or undefined if successful
 */
export async function checkNttTransferStatus(
  txid: string,
  environment: string = "prod"
): Promise<{ status: string; vaa?: Vaa | undefined; error?: any }> {
  try {
    const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Mainnet";

    const wormholeScanApi = new WormholeScanAPI(wormholeEnv !== "Mainnet");
    const response = await wormholeScanApi.get(`/operations?txHash=${txid}`) as BaseWormholeResponse;

    // Check if the response indicates an error
    if (isWormholeErrorResponse(response)) {
      return {
        status: "Error",
        error: {
          code: response.code,
          message: response.message,
          details: response.details
        }
      };
    }

    // Check if operations array exists and has at least one item
    if (!response.operations || response.operations.length === 0) {
      return {
        status: "Error",
        error: {
          message: "No operations found for the provided transaction hash"
        }
      };
    }

    const operation = response.operations[0]

    const overallStatus = getOperationStatus(operation);

    return { status: overallStatus, vaa: operation.vaa };

  } catch (error: any) {
    console.error("Error checking NTT transfer status:", error);

    // Check if the error has a response property (axios error)
    if (error.response && error.response.data) {
      return {
        status: "Error",
        error: error.response.data
      };
    }

    return {
      status: "Error",
      error: {
        message: error.message || "Unknown error occurred while checking transfer status"
      }
    };
  }
}

/**
 * Generates a series of transactions required for a non relayed Wormhole NTT transfer.
 * 
 * This function uses the Wormhole SDK to create all necessary transactions for transferring
 * tokens across chains. It processes the generator pattern used by the Wormhole SDK's transfer
 * method and converts the results into a format compatible with the DIMO transaction system.
 *
 * @param args - The parameters for the bridging operation
 * @param signer - The universal address of the account that will sign the transactions
 * @param destinationAddress - The recipient address on the destination chain
 * @param environment - The environment to use (prod, dev, etc.). Defaults to "prod"
 * @returns A Promise resolving to an array of Call objects representing the transactions
 * @throws Error if there are issues generating the transfer transactions
 */
async function generateWormholeNonRelayedTransferTransactions(
  args: BridgeInitiateArgs,
  signer: UniversalAddress,
  destinationAddress: AccountAddress<any>,
  environment: string = "prod"
): Promise<Call[]> {
  try {
    const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[args.sourceChain];

    // Initialize Wormhole SDK with the appropriate environment and RPC configuration
    const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Mainnet";
    const wormhole = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform], {
      chains: args.rpcConfig,
    });

    // Get the source chain and its NTT protocols
    const sourceChain = wormhole.getChain(mappedSourceChain);
    const sourceNtt = await sourceChain.getProtocol("Ntt", {
      ntt: WORMHOLE_NTT_CONTRACTS[args.sourceChain],
    });

    // Create a generator function for the transfer
    const transferGenerator = () =>
      sourceNtt.transfer(signer, args.amount, destinationAddress, {
        queue: true,
      });

    // Process the generator to collect all transactions
    const transactions: Call[] = [];

    for await (const tx of transferGenerator()) {
      if (tx.transaction) {
        transactions.push({
          to: tx.transaction.to,
          data: tx.transaction.data,
          value: tx.transaction.value ?? BigInt(0)
        });
      }
    }

    return transactions;
  } catch (error) {
    console.error("Error generating Wormhole transfer transactions:", error);
    throw new Error(`Failed to generate Wormhole transfer transactions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generates a series of transactions required for a relayed Wormhole NTT transfer.
 * 
 * This function uses the Wormhole SDK to create all necessary transactions for transferring
 * tokens across chains with automatic relaying. It processes the generator pattern used by 
 * the Wormhole SDK's transfer method, modifies the transfer transaction to set custom refund 
 * addresses, and adjusts the transaction value based on the provided parameters.
 *
 * @param args - The parameters for the bridging operation including source/destination chains and amount
 * @param signer - The universal address of the account that will sign the transactions
 * @param destinationAddress - The recipient address on the destination chain
 * @param environment - The environment to use (prod, dev, etc.). Defaults to "prod"
 * @param msgValue - Optional pre-calculated value to send with the transaction. If null, will be calculated based on quote
 * @param priceIncreasePercentage - Percentage to increase the quoted delivery price by to avoid underfunding. Defaults to 1%. Must be between 0 and 100.
 * @returns A Promise resolving to an array of Call objects representing the transactions to be executed
 * @throws Error if there are issues generating or modifying the transfer transactions
 */
async function generateWormholeRelayedTransferTransactions(
  args: BridgeInitiateArgs,
  signer: UniversalAddress,
  destinationAddress: AccountAddress<any>,
  environment: string = "prod",
  msgValue: bigint | null = null,
  priceIncreasePercentage: number = 1
): Promise<Call[]> {
  try {
    const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[args.sourceChain];

    // Initialize Wormhole SDK with the appropriate environment and RPC configuration
    const wormholeEnv = WORMHOLE_ENV_MAPPING.get(environment) ?? "Mainnet";
    const wormhole = new Wormhole(wormholeEnv as Network, [evm.Platform, solana.Platform], {
      chains: args.rpcConfig,
    });

    // Get the source chain and its NTT protocols
    const sourceChain = wormhole.getChain(mappedSourceChain);
    const sourceNtt = await sourceChain.getProtocol("Ntt", {
      ntt: WORMHOLE_NTT_CONTRACTS[args.sourceChain],
    });
    const sourceNttExecutor = await sourceChain.getProtocol("NttWithExecutor", {
      ntt: WORMHOLE_NTT_CONTRACTS[args.sourceChain],
    });

    // Get the route quote for the transfer
    const routeQuote = await getRouteQuote(
      args.sourceChain as SupportedRelayingWormholeNetworks,
      args.destinationChain,
      environment,
      args.rpcConfig as ChainRpcConfig,
      args.amount
    );

    // Create a generator function for the transfer
    const transferGenerator = () =>
      sourceNttExecutor.transfer(signer, destinationAddress, args.amount, routeQuote, sourceNtt);

    // Process the generator to collect all transactions
    const transactions: Call[] = [];

    // Import ethers Interface for ABI decoding/encoding
    const { Interface } = await import("ethers");

    // Define the ABI for the transfer function
    const transferAbi = [
      "function transfer(address nttManager, uint256 amount, uint16 recipientChain, bytes32 recipientAddress, bytes32 refundAddress, bytes encodedInstructions, (uint256 value, address refundAddress, bytes signedQuote, bytes instructions) executorArgs, (uint16 dbps, address payee) feeArgs) external payable returns (uint64 msgId)",
    ];

    // Create an interface for decoding/encoding
    const iface = new Interface(transferAbi);

    // Process each transaction from the generator
    for await (const tx of transferGenerator()) {
      if (tx.transaction) {
        // If this is the transfer transaction (not the approval)
        if (tx.description === "NttWithExecutor.transfer") {
          try {
            // Decode the transaction data
            const decodedData = iface.parseTransaction({ data: tx.transaction.data }) as TransactionDescription;

            // Get the original parameters
            const nttManager = decodedData.args[0];
            const amount = decodedData.args[1];
            const recipientChain = decodedData.args[2];
            const recipientAddress = decodedData.args[3];
            const encodedInstructions = decodedData.args[5];
            const executorArgs = decodedData.args[6];
            const feeARgs = decodedData.args[7];

            const refundAddress = toUniversal(
              WORMHOLE_CHAIN_MAPPING[args.destinationChain],
              REFUND_ADDRESS_MAPPING[args.destinationChain]
            ).toUint8Array();

            const newExecutorArgs = [
              executorArgs[0],
              REFUND_ADDRESS_MAPPING[args.sourceChain],
              executorArgs[2],
              executorArgs[3]
            ];

            // Re-encode the transaction with the custom refund address
            const newData = iface.encodeFunctionData("transfer", [
              nttManager,
              amount,
              recipientChain,
              recipientAddress,
              refundAddress, // Custom refund address
              encodedInstructions,
              newExecutorArgs,
              feeARgs
            ]) as Hex;

            if (!msgValue) {
              if (priceIncreasePercentage < 0 || priceIncreasePercentage > 100) {
                throw new Error("Price increase percentage must be between 0 and 100");
              }

              msgValue = (tx.transaction.value * BigInt(100 + priceIncreasePercentage)) / BigInt(100);
            }

            // Add the modified transaction
            transactions.push({
              to: tx.transaction.to,
              data: newData,
              value: msgValue ?? tx.transaction.value ?? BigInt(0)
            });
          } catch (error) {
            console.error("Error modifying transfer transaction:", error);
            // If decoding fails, use the original transaction
            transactions.push({
              to: tx.transaction.to,
              data: tx.transaction.data,
              value: tx.transaction.value ?? BigInt(0)
            });
          }
        } else {
          // For non-transfer transactions (like approvals), use as-is
          transactions.push({
            to: tx.transaction.to,
            data: tx.transaction.data,
            value: tx.transaction.value ?? BigInt(0)
          });
        }
      }
    }

    return transactions;
  } catch (error) {
    console.error("Error generating Wormhole transfer transactions:", error);
    throw new Error(`Failed to generate Wormhole transfer transactions: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getRouteQuote(
  sourceChain: SupportedRelayingWormholeNetworks,
  destinationChain: SupportedWormholeNetworks,
  environment: string = "prod",
  rpcConfig: ChainRpcConfig,
  amountTokens: bigint
): Promise<NttWithExecutor.Quote> {
  const mappedSourceChain = WORMHOLE_CHAIN_MAPPING[sourceChain];

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

  return await routeInstance.fetchExecutorQuote(transferRequest, validatedParams);
}