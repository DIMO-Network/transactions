import { Address, maxInt256 } from 'viem'
import { BigNumber } from 'ethers-v5'
import { Token, TradeType } from '@uniswap/sdk-core'
import type { SwapOptions } from '@uniswap/v3-sdk'

import { getSwapCalldata } from ':core/swap/uniswap/uniswap.js'
import { createTokenApprovalTransaction, createWMATICWithdrawTransaction } from ':core/utils/tokens.js'
import { POLYGON_SWAP_ROUTER_ADDRESS } from ':core/constants/contractAddrs.js'
import { WMATIC_TOKEN } from ':core/constants/uniswapConstants.js'

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
  exactOutputAmount: BigInt,
  poolFee: number,
  swapOptions: SwapOptions,
  rpcUrl: string,
  includeApproval: boolean = true,
  approvalAmount?: BigInt
): Promise<Array<{ to: string, data: string, value?: bigint }>> {
  const transactions: Array<{ to: string, data: string, value?: bigint }> = []

  // Add approval transaction if requested
  if (includeApproval) {
    // Use MAX_UINT256 if no specific approval amount is provided
    const amountToApprove = approvalAmount || maxInt256
    transactions.push(createTokenApprovalTransaction(
      tokenIn.address as Address,
      amountToApprove
    ))
  }

  // Get the swap calldata using EXACT_OUTPUT
  const swapCalldata = await getSwapCalldata(
    {
      tokenIn: tokenIn,
      tokenOut: WMATIC_TOKEN,
      amount: BigNumber.from(exactOutputAmount.toString()),
      poolFee: poolFee,
      tradeType: TradeType.EXACT_OUTPUT,
    },
    swapOptions,
    rpcUrl
  )

  // Create the swap transaction
  const swapTransaction = {
    to: POLYGON_SWAP_ROUTER_ADDRESS,
    data: swapCalldata,
    value: BigInt(0)
  }

  // Add swap transaction
  transactions.push(swapTransaction)

  // Create the withdraw transaction with the exact output amount
  const withdrawTransaction = createWMATICWithdrawTransaction(
    WMATIC_TOKEN.address as Address,
    BigInt(exactOutputAmount.toString())
  )

  // Add withdraw transaction
  transactions.push(withdrawTransaction)

  // TODO Set approval to 0

  return transactions
}