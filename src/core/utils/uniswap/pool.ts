import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json' with { type: 'json' }
import { computePoolAddress } from '@uniswap/v3-sdk'
import { Token } from '@uniswap/sdk-core'
import { ethers } from 'ethers-v5'

interface PoolInfo {
  token0?: string
  token1?: string
  fee?: number
  tickSpacing?: number
  liquidity?: ethers.BigNumber
  sqrtPriceX96?: ethers.BigNumber
  tick?: number
}

type PoolParam = 'token0' | 'token1' | 'fee' | 'tickSpacing' | 'liquidity' | 'sqrtPriceX96' | 'tick'

export async function getPoolInfoByAddress(
  poolAddress: `0x${string}`,
  rpcUrl: string,
  params?: PoolParam[]
): Promise<PoolInfo> {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
  if (!provider) {
    throw new Error('No provider')
  }

  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI.abi,
    provider
  )

  // Determine which parameters to fetch based on the params argument
  const fetchToken0 = !params || params.includes('token0')
  const fetchToken1 = !params || params.includes('token1')
  const fetchFee = !params || params.includes('fee')
  const fetchTickSpacing = !params || params.includes('tickSpacing')
  const fetchLiquidity = !params || params.includes('liquidity')
  const fetchSlot0 = !params || params.includes('sqrtPriceX96') || params.includes('tick')

  // Create an array of promises for the parameters we need to fetch
  const promises = []
  if (fetchToken0) promises.push(poolContract.token0())
  if (fetchToken1) promises.push(poolContract.token1())
  if (fetchFee) promises.push(poolContract.fee())
  if (fetchTickSpacing) promises.push(poolContract.tickSpacing())
  if (fetchLiquidity) promises.push(poolContract.liquidity())
  if (fetchSlot0) promises.push(poolContract.slot0())

  // Execute all promises in parallel
  const results = await Promise.all(promises)
  
  // Initialize the result object
  const poolInfo: PoolInfo = {}
  
  // Populate the result object based on which parameters were fetched
  let resultIndex = 0
  
  if (fetchToken0) poolInfo.token0 = results[resultIndex++]
  if (fetchToken1) poolInfo.token1 = results[resultIndex++]
  if (fetchFee) poolInfo.fee = results[resultIndex++]
  if (fetchTickSpacing) poolInfo.tickSpacing = results[resultIndex++]
  if (fetchLiquidity) poolInfo.liquidity = results[resultIndex++]
  if (fetchSlot0) {
    const slot0 = results[resultIndex++]
    if (!params || params.includes('sqrtPriceX96')) poolInfo.sqrtPriceX96 = slot0[0]
    if (!params || params.includes('tick')) poolInfo.tick = slot0[1]
  }
  
  return poolInfo
}

export async function getPoolInfo(
  factoryAddress: string,
  tokenA: Token,
  tokenB: Token,
  poolFee: number,
  rpcUrl: string,
  params?: PoolParam[]
): Promise<PoolInfo> {
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl)

  if (!provider) {
    throw new Error('No provider')
  }

  const currentPoolAddress = computePoolAddress({
    factoryAddress,
    tokenA,
    tokenB,
    fee: poolFee,
  })

  const poolContract = new ethers.Contract(
    currentPoolAddress,
    IUniswapV3PoolABI.abi,
    provider
  )

  // Determine which parameters to fetch based on the params argument
  // token0 and token1 are derived from tokenA and tokenB, and fee is provided as poolFee
  const fetchTickSpacing = !params || params.includes('tickSpacing')
  const fetchLiquidity = !params || params.includes('liquidity')
  const fetchSlot0 = !params || params.includes('sqrtPriceX96') || params.includes('tick')

  // Create an array of promises for the parameters we need to fetch
  const promises = []
  if (fetchTickSpacing) promises.push(poolContract.tickSpacing())
  if (fetchLiquidity) promises.push(poolContract.liquidity())
  if (fetchSlot0) promises.push(poolContract.slot0())

  // Execute all promises in parallel
  const results = await Promise.all(promises)
  
  // Initialize the result object with token0, token1, and fee
  const poolInfo: PoolInfo = {}
  
  // Always include token0, token1, and fee if they're in the params list or if params is undefined
  if (!params || params.includes('token0')) poolInfo.token0 = tokenA.address
  if (!params || params.includes('token1')) poolInfo.token1 = tokenB.address
  if (!params || params.includes('fee')) poolInfo.fee = poolFee
  
  // Populate the result object based on which parameters were fetched
  let resultIndex = 0
  
  if (fetchTickSpacing) poolInfo.tickSpacing = results[resultIndex++]
  if (fetchLiquidity) poolInfo.liquidity = results[resultIndex++]
  if (fetchSlot0) {
    const slot0 = results[resultIndex++]
    if (!params || params.includes('sqrtPriceX96')) poolInfo.sqrtPriceX96 = slot0[0]
    if (!params || params.includes('tick')) poolInfo.tick = slot0[1]
  }
  
  return poolInfo
}
