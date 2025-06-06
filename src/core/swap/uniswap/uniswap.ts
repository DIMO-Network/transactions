import { Currency, CurrencyAmount, Token, TradeType } from "@uniswap/sdk-core";
import { Pool, Route, SwapOptions, SwapQuoter, SwapRouter, Trade } from "@uniswap/v3-sdk";
import { ethers, BigNumber } from "ethers-v5";

import { TokenTrade, SwapParams, PoolInfo, PoolParam } from ":core/types/uniswap.js";
import {
  POLYGON_QUOTER_CONTRACT_ADDRESS,
  POLYGON_POOL_FACTORY_CONTRACT_ADDRESS,
} from ":core/constants/contractAddrs.js";

import { getPoolInfo } from "./pool.js";

export async function getSwapCalldata(
  swapParams: SwapParams,
  swapOptions: SwapOptions,
  rpcUrl: string
): Promise<string> {
  const trade = await createTrade(swapParams, rpcUrl);

  const { calldata } = SwapRouter.swapCallParameters([trade], swapOptions);

  return calldata;
}

async function createTrade(swapParams: SwapParams, rpcUrl: string): Promise<TokenTrade> {
  const { tokenIn, tokenOut, amount, poolFee, tradeType } = swapParams;

  const poolInfo: PoolInfo = await getPoolInfo(
    POLYGON_POOL_FACTORY_CONTRACT_ADDRESS,
    tokenIn,
    tokenOut,
    poolFee,
    rpcUrl,
    [PoolParam.SQRT_PRICE_X96, PoolParam.LIQUIDITY, PoolParam.TICK]
  );

  const pool = new Pool(
    tokenIn,
    tokenOut,
    poolFee,
    poolInfo.sqrtPriceX96?.toString() || "0",
    poolInfo.liquidity?.toString() || "0",
    poolInfo.tick || 0
  );

  const swapRoute = new Route([pool], tokenIn, tokenOut);

  const amountString = amount.toString();
  let inputAmount: CurrencyAmount<Token>;
  let outputAmount: CurrencyAmount<Token>;

  if (tradeType === TradeType.EXACT_INPUT) {
    // For EXACT_INPUT, we know the input amount and need to calculate the output
    inputAmount = CurrencyAmount.fromRawAmount(tokenIn, amountString);
    const outputQuote = await getOutputQuote(swapRoute, tokenIn, amount, tradeType, rpcUrl);
    outputAmount = CurrencyAmount.fromRawAmount(tokenOut, outputQuote.toString());
  } else {
    // For EXACT_OUTPUT, we know the output amount and need to calculate the input
    outputAmount = CurrencyAmount.fromRawAmount(tokenOut, amountString);
    const inputQuote = await getOutputQuote(swapRoute, tokenOut, amount, tradeType, rpcUrl);
    inputAmount = CurrencyAmount.fromRawAmount(tokenIn, inputQuote.toString());
  }

  const uncheckedTrade = Trade.createUncheckedTrade({
    route: swapRoute,
    inputAmount,
    outputAmount,
    tradeType,
  });

  return uncheckedTrade;
}

async function getOutputQuote(
  route: Route<Currency, Currency>,
  token: Token,
  amount: BigNumber,
  tradeType: TradeType,
  rpcUrl: string
) {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  if (!provider) {
    throw new Error("Provider required to get pool state");
  }

  const tokenAmount = CurrencyAmount.fromRawAmount(token, amount.toString());

  const { calldata } = SwapQuoter.quoteCallParameters(route, tokenAmount, tradeType, {
    useQuoterV2: true,
  });

  const quoteCallReturnData = await provider.call({
    to: POLYGON_QUOTER_CONTRACT_ADDRESS,
    data: calldata,
  });

  return ethers.utils.defaultAbiCoder.decode(["uint256"], quoteCallReturnData)[0];
}
