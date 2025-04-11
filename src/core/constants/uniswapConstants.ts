import { ChainId, Token } from '@uniswap/sdk-core'

import { POLYGON_DIMO_TOKEN_ADDRESS, POLYGON_WMATIC_TOKEN } from ":core/constants/contractAddrs.js"

export const POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_POOL_FEE = 10000;

export const WMATIC_TOKEN = new Token(
    ChainId.POLYGON,
    POLYGON_WMATIC_TOKEN,
    18,
    'WETH',
    'Wrapped Ether'
)

export const DIMO_TOKEN = new Token(
    ChainId.POLYGON,
    POLYGON_DIMO_TOKEN_ADDRESS,
    18,
    'DIMO',
    'Dimo'
)