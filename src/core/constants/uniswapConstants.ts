import { ChainId, Token } from '@uniswap/sdk-core'

export const POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_POOL_VALUES = {
    token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    token1: '0xE261D618a959aFfFd53168Cd07D12E37B26761db ',
    fee: '10000',
    tickSpacing: '200'
}

export const POOL_FACTORY_CONTRACT_ADDRESS =
    '0x1F98431c8aD98523631AE4a59f267346ea31F984'
export const QUOTER_CONTRACT_ADDRESS =
    '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
export const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
export const WETH_CONTRACT_ADDRESS =
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

export const WMATIC_TOKEN = new Token(
    ChainId.POLYGON,
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    18,
    'WETH',
    'Wrapped Ether'
)

export const DIMO_TOKEN = new Token(
    ChainId.POLYGON,
    '0xE261D618a959aFfFd53168Cd07D12E37B26761db',
    18,
    'DIMO',
    'Dimo'
)