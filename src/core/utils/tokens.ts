import { encodeFunctionData, Address, maxInt256, erc20Abi } from 'viem'

import type { Call } from ":core/types/common.js"
import { abiWmatic } from ":core/abis/index.js"
import { POLYGON_SWAP_ROUTER_ADDRESS } from ':core/constants/contractAddrs.js'

/**
 * Creates a transaction object to withdraw POL from WMATIC
 * @param wMATICAddress - The address of the WMATIC contract
 * @param amount - Amount of WMATIC to withdraw as MATIC
 * @returns Transaction object ready to be sent
 */
export function createWMATICWithdrawTransaction(
  wMATICAddress: Address,
  amount: bigint
) {
  return {
    to: wMATICAddress,
    data: encodeFunctionData({
      abi: abiWmatic,
      functionName: 'withdraw',
      args: [BigInt(amount.toString())]
    }),
    value: BigInt(0)
  }
}

/**
 * Creates a transaction to approve the Uniswap router to spend tokens
 * 
 * @param tokenAddress The address of the token to approve
 * @param amount The amount to approve. If not provided, maxInt256 will be used for unlimited approval
 * @returns Transaction object for the approval
 */
export function createTokenApprovalTransaction(
  tokenAddress: Address,
  amount?: bigint
): Call {
  return {
    to: tokenAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [POLYGON_SWAP_ROUTER_ADDRESS as Address, amount ?? maxInt256]
    }),
    value: BigInt(0)
  }
}