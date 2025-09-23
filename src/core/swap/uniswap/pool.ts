import { Token } from "@uniswap/sdk-core";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json" with { type: "json" };
import { computePoolAddress } from "@uniswap/v3-sdk";
import { createPublicClient, http, type Hex } from "viem";

import { PoolInfo, PoolParam } from ":core/types/uniswap.js";

export async function getPoolInfoByAddress(poolAddress: Hex, rpcUrl: string, params?: PoolParam[]): Promise<PoolInfo> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  // Determine which parameters to fetch based on the params argument
  const fetchToken0 = !params || params.includes(PoolParam.TOKEN0);
  const fetchToken1 = !params || params.includes(PoolParam.TOKEN1);
  const fetchFee = !params || params.includes(PoolParam.FEE);
  const fetchTickSpacing = !params || params.includes(PoolParam.TICK_SPACING);
  const fetchLiquidity = !params || params.includes(PoolParam.LIQUIDITY);
  const fetchSlot0 = !params || params.includes(PoolParam.SQRT_PRICE_X96) || params.includes(PoolParam.TICK);

  // Create an array of promises for the parameters we need to fetch
  const promises = [];
  if (fetchToken0) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "token0" }));
  if (fetchToken1) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "token1" }));
  if (fetchFee) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "fee" }));
  if (fetchTickSpacing) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "tickSpacing" }));
  if (fetchLiquidity) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "liquidity" }));
  if (fetchSlot0) promises.push(client.readContract({ address: poolAddress, abi: IUniswapV3PoolABI.abi, functionName: "slot0" }));

  // Execute all promises in parallel
  const results = await Promise.all(promises);

  // Initialize the result object
  const poolInfo: PoolInfo = {};

  // Populate the result object based on which parameters were fetched
  let resultIndex = 0;

  if (fetchToken0) poolInfo.token0 = results[resultIndex++] as string;
  if (fetchToken1) poolInfo.token1 = results[resultIndex++] as string;
  if (fetchFee) poolInfo.fee = results[resultIndex++] as number;
  if (fetchTickSpacing) poolInfo.tickSpacing = results[resultIndex++] as number;
  if (fetchLiquidity) poolInfo.liquidity = results[resultIndex++] as bigint;
  if (fetchSlot0) {
    const slot0 = results[resultIndex++] as [bigint, number];
    if (!params || params.includes(PoolParam.SQRT_PRICE_X96)) poolInfo.sqrtPriceX96 = slot0[0];
    if (!params || params.includes(PoolParam.TICK)) poolInfo.tick = slot0[1];
  }

  return poolInfo;
}

export async function getPoolInfo(
  factoryAddress: string,
  tokenA: Token,
  tokenB: Token,
  poolFee: number,
  rpcUrl: string,
  params?: PoolParam[]
): Promise<PoolInfo> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const currentPoolAddress = computePoolAddress({
    factoryAddress,
    tokenA,
    tokenB,
    fee: poolFee,
  });

  // Determine which parameters to fetch based on the params argument
  // token0 and token1 are derived from tokenA and tokenB, and fee is provided as poolFee
  const fetchTickSpacing = !params || params.includes(PoolParam.TICK_SPACING);
  const fetchLiquidity = !params || params.includes(PoolParam.LIQUIDITY);
  const fetchSlot0 = !params || params.includes(PoolParam.SQRT_PRICE_X96) || params.includes(PoolParam.TICK);

  // Create an array of promises for the parameters we need to fetch
  const promises = [];
  if (fetchTickSpacing) promises.push(client.readContract({ address: currentPoolAddress as `0x${string}`, abi: IUniswapV3PoolABI.abi, functionName: "tickSpacing" }));
  if (fetchLiquidity) promises.push(client.readContract({ address: currentPoolAddress as `0x${string}`, abi: IUniswapV3PoolABI.abi, functionName: "liquidity" }));
  if (fetchSlot0) promises.push(client.readContract({ address: currentPoolAddress as `0x${string}`, abi: IUniswapV3PoolABI.abi, functionName: "slot0" }));

  // Execute all promises in parallel
  const results = await Promise.all(promises);

  // Initialize the result object with token0, token1, and fee
  const poolInfo: PoolInfo = {};

  // Always include token0, token1, and fee if they're in the params list or if params is undefined
  if (!params || params.includes(PoolParam.TOKEN0)) poolInfo.token0 = tokenA.address;
  if (!params || params.includes(PoolParam.TOKEN1)) poolInfo.token1 = tokenB.address;
  if (!params || params.includes(PoolParam.FEE)) poolInfo.fee = poolFee;

  // Populate the result object based on which parameters were fetched
  let resultIndex = 0;

  if (fetchTickSpacing) poolInfo.tickSpacing = results[resultIndex++] as number;
  if (fetchLiquidity) poolInfo.liquidity = results[resultIndex++] as bigint;
  if (fetchSlot0) {
    const slot0 = results[resultIndex++] as [bigint, number];
    if (!params || params.includes(PoolParam.SQRT_PRICE_X96)) poolInfo.sqrtPriceX96 = slot0[0];
    if (!params || params.includes(PoolParam.TICK)) poolInfo.tick = slot0[1];
  }

  return poolInfo;
}
