import { Abi, zeroAddress } from "viem";
import { Chain, polygon, polygonAmoy } from "viem/chains";
import { Token } from "@uniswap/sdk-core";

import { API_BY_ENV, AllChainInfos, ContractType, DIMO_APIs, ENVIRONMENT } from ":core/types/dimo.js";
import { NttContracts, SupportedWormholeNetworks } from ":core/types/wormhole.js";
import { UniswapMappingArgs } from ":core/types/uniswap.js";
import { Network } from "@wormhole-foundation/sdk";
import {
  abiCredits,
  abiForwarder,
  abiRegistry,
  abiSacd,
  abiStaking,
  abiStakingDev,
  abiToken,
  abiVehicleId,
  abiUniswapV3Pool,
} from ":core/abis/index.js";

import * as contractAddrs from ":core/constants/contractAddrs.js";
import * as uniswapConsts from ":core/constants/uniswapConstants.js";

export const ENV_NETWORK_MAPPING = new Map<ENVIRONMENT, Chain>([
  [ENVIRONMENT.PROD, polygon],
  [ENVIRONMENT.PROD_TEST, polygon],
  [ENVIRONMENT.DEV, polygonAmoy],
]);

export const ENV_MAPPING = new Map<string, ENVIRONMENT>([
  ["production", ENVIRONMENT.PROD],
  ["prod", ENVIRONMENT.PROD],

  ["production_test", ENVIRONMENT.PROD_TEST],
  ["prod_test", ENVIRONMENT.PROD_TEST],

  ["development", ENVIRONMENT.DEV],
  ["dev", ENVIRONMENT.DEV],
]);

export const WORMHOLE_ENV_MAPPING = new Map<string, Network>([
  ["production", "Mainnet"],
  ["prod", "Mainnet"],

  ["production_test", "Mainnet"],
  ["prod_test", "Mainnet"],

  ["development", "Testnet"],
  ["dev", "Testnet"],
]);

export const WORMHOLE_CHAIN_MAPPING: Record<SupportedWormholeNetworks, "Ethereum" | "Polygon" | "Base" | "Solana"> = {
  Ethereum: "Ethereum",
  Polygon: "Polygon",
  Base: "Base",
  EthereumTest: "Ethereum",
  PolygonTest: "Polygon",
  BaseTest: "Base",
  SolanaTest: "Solana",
};

export const ENV_TO_API_MAPPING: API_BY_ENV = {
  [ENVIRONMENT.PROD]: {
    [DIMO_APIs.ATTESTATION]: { url: "https://attestation-api.dimo.zone" },
    [DIMO_APIs.AUTH]: { url: "https://auth.dimo.zone" },
    [DIMO_APIs.IDENTITY]: { url: "https://identity-api.dimo.zone/query" },
    [DIMO_APIs.DEVICES]: { url: "https://devices-api.dimo.zone" },
    [DIMO_APIs.DEVICE_DATA]: { url: "https://device-data-api.dimo.zone" },
    [DIMO_APIs.DEVICE_DEFINITIONS]: { url: "https://device-definitions-api.dimo.zone" },
    [DIMO_APIs.EVENTS]: { url: "https://events-api.dimo.zone" },
    [DIMO_APIs.TELEMETRY]: { url: "https://telemetry-api.dimo.zone/query" },
    [DIMO_APIs.TOKEN_EXCHANGE]: { url: "https://token-exchange-api.dimo.zone" },
    [DIMO_APIs.TRIPS]: { url: "https://trips-api.dimo.zone" },
    [DIMO_APIs.USER]: { url: "https://users-api.dimo.zone" },
    [DIMO_APIs.VALUATIONS]: { url: "https://valuations-api.dimo.zone" },
    [DIMO_APIs.VEHICLE_SIGNAL_DECODING]: { url: "https://vehicle-signal-decoding.dimo.zone" },
    [DIMO_APIs.IPFS]: { url: "https://assets.dimo.org/ipfs" },
  },
  [ENVIRONMENT.DEV]: {
    [DIMO_APIs.ATTESTATION]: { url: "https://attestation-api.dev.dimo.zone" },
    [DIMO_APIs.AUTH]: { url: "https://auth.dev.dimo.zone" },
    [DIMO_APIs.IDENTITY]: { url: "https://identity-api.dev.dimo.zone/query" },
    [DIMO_APIs.DEVICES]: { url: "https://devices-api.dev.dimo.zone" },
    [DIMO_APIs.DEVICE_DATA]: { url: "https://device-data-api.dev.dimo.zone" },
    [DIMO_APIs.DEVICE_DEFINITIONS]: { url: "https://device-definitions-api.dev.dimo.zone" },
    [DIMO_APIs.EVENTS]: { url: "https://events-api.dev.dimo.zone" },
    [DIMO_APIs.TELEMETRY]: { url: "https://telemetry-api.dev.dimo.zone/query" },
    [DIMO_APIs.TOKEN_EXCHANGE]: { url: "https://token-exchange-api.dev.dimo.zone" },
    [DIMO_APIs.TRIPS]: { url: "https://trips-api.dev.dimo.zone" },
    [DIMO_APIs.USER]: { url: "https://users-api.dev.dimo.zone" },
    [DIMO_APIs.VALUATIONS]: { url: "https://valuations-api.dev.dimo.zone" },
    [DIMO_APIs.VEHICLE_SIGNAL_DECODING]: { url: "https://vehicle-signal-decoding.dev.dimo.zone" },
    [DIMO_APIs.IPFS]: { url: "https://assets.dimo.org/ipfs" },
  },
  [ENVIRONMENT.PROD_TEST]: {
    [DIMO_APIs.ATTESTATION]: { url: "https://attestation-api.dimo.zone" },
    [DIMO_APIs.AUTH]: { url: "https://auth.dimo.zone" },
    [DIMO_APIs.IDENTITY]: { url: "https://identity-api.dimo.zone/query" },
    [DIMO_APIs.DEVICES]: { url: "https://devices-api.dimo.zone" },
    [DIMO_APIs.DEVICE_DATA]: { url: "https://device-data-api.dimo.zone" },
    [DIMO_APIs.DEVICE_DEFINITIONS]: { url: "https://device-definitions-api.dimo.zone" },
    [DIMO_APIs.EVENTS]: { url: "https://events-api.dimo.zone" },
    [DIMO_APIs.TELEMETRY]: { url: "https://telemetry-api.dimo.zone/query" },
    [DIMO_APIs.TOKEN_EXCHANGE]: { url: "https://token-exchange-api.dimo.zone" },
    [DIMO_APIs.TRIPS]: { url: "https://trips-api.dimo.zone" },
    [DIMO_APIs.USER]: { url: "https://users-api.dimo.zone" },
    [DIMO_APIs.VALUATIONS]: { url: "https://valuations-api.dimo.zone" },
    [DIMO_APIs.VEHICLE_SIGNAL_DECODING]: { url: "https://vehicle-signal-decoding.dimo.zone" },
    [DIMO_APIs.IPFS]: { url: "https://assets.dimo.org/ipfs" },
  },
};

export const CHAIN_ABI_MAPPING: AllChainInfos = {
  [ENVIRONMENT.DEV]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: contractAddrs.AMOY_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits as Abi,
        address: contractAddrs.AMOY_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: contractAddrs.AMOY_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: contractAddrs.AMOY_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: contractAddrs.AMOY_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: contractAddrs.AMOY_DIMO_FORWARDER,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStakingDev,
        address: contractAddrs.AMOY_DIMO_STAKING_ADDRESS,
      },
      [ContractType.UNISWAP_V3_POOL]: {
        abi: abiUniswapV3Pool,
        address: zeroAddress,
      },
    },
  },
  [ENVIRONMENT.PROD]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: contractAddrs.POLYGON_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits,
        address: contractAddrs.POLYGON_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: contractAddrs.POLYGON_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: contractAddrs.POLYGON_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: contractAddrs.POLYGON_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: contractAddrs.POLYGON_DIMO_FORWARDER,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStaking,
        address: contractAddrs.POLYGON_DIMO_STAKING_ADDRESS,
      },
      [ContractType.UNISWAP_V3_POOL]: {
        abi: abiUniswapV3Pool,
        address: contractAddrs.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
      },
    },
  },
  [ENVIRONMENT.PROD_TEST]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: zeroAddress,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits,
        address: zeroAddress,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: zeroAddress,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: zeroAddress,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: contractAddrs.POLYGON_TEST_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: zeroAddress,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStaking,
        address: zeroAddress,
      },
      [ContractType.UNISWAP_V3_POOL]: {
        abi: abiUniswapV3Pool,
        address: contractAddrs.POLYGON_TEST_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
      },
    },
  },
};

export const WORMHOLE_NTT_CONTRACTS: NttContracts = {
  Ethereum: {
    token: contractAddrs.ETHEREUM_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.ETHEREUM_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.ETHEREUM_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Polygon: {
    token: contractAddrs.POLYGON_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.POLYGON_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.POLYGON_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Base: {
    token: contractAddrs.BASE_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.BASE_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.BASE_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Solana: {
    token: contractAddrs.SOLANA_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.SOLANA_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.SOLANA_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  EthereumTest: {
    token: contractAddrs.ETHEREUM_TEST_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.ETHEREUM_TEST_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.ETHEREUM_TEST_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  PolygonTest: {
    token: contractAddrs.POLYGON_TEST_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.POLYGON_TEST_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.POLYGON_TEST_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  BaseTest: {
    token: contractAddrs.BASE_TEST_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.BASE_TEST_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.BASE_TEST_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  SolanaTest: {
    token: contractAddrs.SOLANA_TEST_DIMO_TOKEN_ADDRESS,
    manager: "",
    transceiver: { wormhole: "" },
  },
};

export const WORMHOLE_TRANSCEIVER_INSTRUCTIONS = {
  relayed: "0x01000100",
  notRelayed: "0x01000101",
};

export const UNISWAP_ARGS_MAPPING: UniswapMappingArgs = {
  [ENVIRONMENT.PROD]: {
    dimoToken: uniswapConsts.DIMO_TOKEN,
    uniswapV3Pool: contractAddrs.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
    poolFee: uniswapConsts.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_POOL_FEE,
  },
  [ENVIRONMENT.PROD_TEST]: {
    dimoToken: uniswapConsts.TEST_DIMO_TOKEN,
    uniswapV3Pool: contractAddrs.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
    poolFee: uniswapConsts.POLYGON_TEST_UNISWAP_V3_POOL_WMATIC_DIMO_POOL_FEE,
  },
  [ENVIRONMENT.DEV]: {
    dimoToken: new Token(0, zeroAddress, 0),
    uniswapV3Pool: "",
    poolFee: 0,
  },
};

// TODO parse error messages with abi to give specific message
export const OnChainErrors = {
  "UserOperation reverted during simulation with reason: 0x15bdaac1": "Aftermarket device not claimed",
  "UserOperation reverted during simulation with reason: 0x762116ae": "Aftermarket device paired",
  "UserOperation reverted during simulation with reason: 0xe3ca9639": "Invalid node",
  "UserOperation reverted during simulation with reason: 0xc9134785": "Insufficient hex length",
  "UserOperation reverted during simulation with reason: 0xc46a5168": "Cannot burn paired vehicle",
};
