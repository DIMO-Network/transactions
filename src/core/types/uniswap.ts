import { Token, TradeType } from '@uniswap/sdk-core'
import { Trade } from '@uniswap/v3-sdk'
import { BigNumber } from 'ethers-v5'

export type TokenTrade = Trade<Token, Token, TradeType>

export type SwapParams = {
    tokenIn: Token
    tokenOut: Token
    amount: BigNumber
    poolFee: number
    tradeType: TradeType
}