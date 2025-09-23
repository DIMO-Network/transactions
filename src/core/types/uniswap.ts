import { Token, TradeType } from "@uniswap/sdk-core";
import { Trade } from "@uniswap/v3-sdk";

import { ENVIRONMENT } from ":core/types/dimo.js";

export type TokenTrade = Trade<Token, Token, TradeType>;

export type SwapParams = {
  tokenIn: Token;
  tokenOut: Token;
  amount: bigint;
  poolFee: number;
  tradeType: TradeType;
};

export type UniswapMappingArgs = {
  [key in ENVIRONMENT]: {
    dimoToken: Token;
    uniswapV3Pool: string;
    poolFee: number;
  };
};

export interface PoolInfo {
  token0?: string;
  token1?: string;
  fee?: number;
  tickSpacing?: number;
  liquidity?: bigint;
  sqrtPriceX96?: bigint;
  tick?: number;
}

export enum PoolParam {
  TOKEN0 = "token0",
  TOKEN1 = "token1",
  FEE = "fee",
  TICK_SPACING = "tickSpacing",
  LIQUIDITY = "liquidity",
  SQRT_PRICE_X96 = "sqrtPriceX96",
  TICK = "tick",
}
