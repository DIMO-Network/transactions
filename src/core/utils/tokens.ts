import { encodeFunctionData, Address, maxInt256 } from 'viem'

import { SWAP_ROUTER_ADDRESS } from ':core/constants/uniswapConstants.js'

// ABI for the WMATIC withdraw function
const WMATIC_ABI = [
  {
    constant: false,
    inputs: [{ name: 'wad', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

// ERC20 approval ABI
const ERC20_APPROVAL_ABI = [
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

/**
 * Creates a transaction object to withdraw POL from WMATIC
 * @param wMATICAddress - The address of the WMATIC contract
 * @param amount - Amount of WMATIC to withdraw as MATIC
 * @returns Transaction object ready to be sent
 */
export function createWMATICWithdrawTransaction(
  wMATICAddress: Address,
  amount: BigInt
) {
  return {
    to: wMATICAddress,
    data: encodeFunctionData({
      abi: WMATIC_ABI,
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
  amount?: BigInt
): { to: string, data: string, value: bigint } {
  return {
    to: tokenAddress,
    data: encodeFunctionData({
      abi: ERC20_APPROVAL_ABI,
      functionName: 'approve',
      args: [SWAP_ROUTER_ADDRESS as Address, amount ?? maxInt256]
    }),
    value: BigInt(0)
  }
}