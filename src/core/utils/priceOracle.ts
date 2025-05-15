import { createPublicClient, http, parseAbi } from "viem";
import { polygon } from "viem/chains";

import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";

/**
 * Retrieves the current price of DIMO tokens from a Uniswap V3 pool.
 *
 * This function queries a Uniswap V3 pool contract to get the current square root price
 * and calculates the actual price of DIMO tokens in terms of the paired token (WMATIC).
 *
 * @param environment - The environment string used to determine the appropriate contract addresses.
 * @param rpcUrl - The URL of the RPC endpoint to connect to the Polygon network.
 * @returns A Promise that resolves to a BigInt representing the price of DIMO tokens in wei.
 * @throws Error if the Uniswap pool address is zero.
 */
export async function getDIMOPriceFromUniswapV3(environment: string, rpcUrl: string): Promise<bigint> {
  const UNISWAP_V3_POOL_ABI = parseAbi([
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  ]);

  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const client = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });

  const poolAddress = contracts[ContractType.UNISWAP_V3_POOL].address;

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Uniswap pool address is zero for environment: ${environment}`);
  }

  // Fetch the current sqrtPriceX96 from the pool
  const [sqrtPriceX96] = await client.readContract({
    address: poolAddress,
    abi: UNISWAP_V3_POOL_ABI,
    functionName: "slot0",
  });

  // Calculate the price from sqrtPriceX96
  const price = (sqrtPriceX96 * sqrtPriceX96 * BigInt(1e18)) / BigInt(2) ** BigInt(192);

  return price;
}
