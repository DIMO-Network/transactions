import { Token, TradeType } from "@uniswap/sdk-core";
import type { SwapOptions } from "@uniswap/v3-sdk";
import { Address, Hex, maxInt256 } from "viem";

import { POLYGON_SWAP_ROUTER_ADDRESS } from ":core/constants/contractAddrs.js";
import { WMATIC_TOKEN } from ":core/constants/uniswapConstants.js";
import { getSwapCalldata } from ":core/swap/uniswap/uniswap.js";
import type { Call } from ":core/types/common.js";
import { createTokenApprovalTransaction, createWMATICWithdrawTransaction } from ":core/utils/tokens.js";

/**
 * Generates transaction data for swapping tokens to WMATIC and then withdrawing to POL
 * with an exact output amount
 *
 * @param tokenIn The token to swap from
 * @param exactOutputAmount The exact amount of POL to receive after withdrawal
 * @param poolFee The fee tier for the Uniswap pool
 * @param swapOptions Options for the swap
 * @param rpcUrl The RPC URL for the network
 * @param includeApproval Whether to include the approval transaction (default: true)
 * @param approvalAmount The amount to approve, defaults to MAX_UINT256 for unlimited approval
 * @returns An array of transaction objects to execute
 */
export async function swapToExactPOL(
  tokenIn: Token,
  exactOutputAmount: bigint,
  poolFee: number,
  swapOptions: SwapOptions,
  rpcUrl: string,
  includeApproval: boolean = true,
  approvalAmount?: bigint
): Promise<Array<Call>> {
  const transactions: Array<Call> = [];

  // Add approval transaction if requested
  if (includeApproval) {
    // Use MAX_UINT256 if no specific approval amount is provided
    const amountToApprove = approvalAmount || maxInt256;
    transactions.push(createTokenApprovalTransaction(tokenIn.address as Address, amountToApprove));
  }

  // Get the swap calldata using EXACT_OUTPUT
  const swapCalldata = await getSwapCalldata(
    {
      tokenIn: tokenIn,
      tokenOut: WMATIC_TOKEN,
      amount: BigInt(exactOutputAmount.toString()),
      poolFee: poolFee,
      tradeType: TradeType.EXACT_OUTPUT,
    },
    swapOptions,
    rpcUrl
  );

  // Create the swap transaction
  const swapTransaction = {
    to: POLYGON_SWAP_ROUTER_ADDRESS as Hex,
    data: swapCalldata as Hex,
    value: BigInt(0),
  };

  // Add swap transaction
  transactions.push(swapTransaction);

  // Create the withdraw transaction with the exact output amount
  const withdrawTransaction = createWMATICWithdrawTransaction(
    WMATIC_TOKEN.address as Address,
    BigInt(exactOutputAmount.toString())
  );

  // Add withdraw transaction
  transactions.push(withdrawTransaction);

  // Reset approval to 0 after the swap is complete
  if (includeApproval) {
    transactions.push(createTokenApprovalTransaction(tokenIn.address as Address, BigInt(0)));
  }

  return transactions;
}
