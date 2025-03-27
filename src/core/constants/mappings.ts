import { Abi } from "viem";
import { Chain, polygon, polygonAmoy } from "viem/chains";

import { API_BY_ENV, AllChainInfos, ContractType, DIMO_APIs, ENVIRONMENT } from ":core/types/dimo.js";
import { NttContracts, SupportedWormholeNetworks } from ":core/types/wormhole.js";
import { Network } from "@wormhole-foundation/sdk";
import { abiForwarder } from ":core/abis/DimoForwarder.js";
import { abiVehicleId } from ":core/abis/DimoVehicleId.js";
import { abiRegistry } from ":core/abis/DimoRegistry.js";
import { abiCredits } from ":core/abis/DimoCredit.js";
import { abiToken } from ":core/abis/DimoToken.js";
import { abiSacd } from ":core/abis/DimoSacd.js";
import { abiStaking, abiStakingDev } from ":core/abis/DimoStaking.js";
import { abiUniswapV3Pool } from ":core/abis/UniswapV3Pool.js";

import * as C from ":core/constants/contractAddrs.js";

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
        address: C.AMOY_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits as Abi,
        address: C.AMOY_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: C.AMOY_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: C.AMOY_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: C.AMOY_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: C.AMOY_DIMO_FORWARDER,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStakingDev,
        address: C.AMOY_DIMO_STAKING_ADDRESS,
      },
      [ContractType.UNISWAP_V3_POOL_WMATIC_DIMO]: {
        abi: abiUniswapV3Pool,
        address: C.ZERO_ADDRESS,
      },
    },
  },
  [ENVIRONMENT.PROD]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: C.POLYGON_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits,
        address: C.POLYGON_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: C.POLYGON_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: C.POLYGON_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: C.POLYGON_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: C.POLYGON_DIMO_FORWARDER,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStaking,
        address: C.POLYGON_DIMO_STAKING_ADDRESS,
      },
      [ContractType.UNISWAP_V3_POOL_WMATIC_DIMO]: {
        abi: abiUniswapV3Pool,
        address: C.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
      },
    },
  },
  [ENVIRONMENT.PROD_TEST]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: C.POLYGON_TEST_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.DIMO_STAKING]: {
        abi: abiStaking,
        address: C.ZERO_ADDRESS,
      },
      [ContractType.UNISWAP_V3_POOL_WMATIC_DIMO]: {
        abi: abiUniswapV3Pool,
        address: C.POLYGON_UNISWAP_V3_POOL_WMATIC_DIMO_ADDRESS,
      },
    },
  },
};

export const WORMHOLE_NTT_CONTRACTS: NttContracts = {
  Ethereum: {
    token: C.ETHEREUM_DIMO_TOKEN_ADDRESS,
    manager: C.ETHEREUM_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: C.ETHEREUM_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Polygon: {
    token: C.POLYGON_DIMO_TOKEN_ADDRESS,
    manager: C.POLYGON_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: C.POLYGON_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Base: {
    token: C.BASE_DIMO_TOKEN_ADDRESS,
    manager: C.BASE_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: C.BASE_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  PolygonTest: {
    token: C.POLYGON_TEST_DIMO_TOKEN_ADDRESS,
    manager: C.POLYGON_TEST_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: C.POLYGON_TEST_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  BaseTest: {
    token: C.BASE_TEST_DIMO_TOKEN_ADDRESS,
    manager: C.BASE_TEST_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: C.BASE_TEST_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  SolanaTest: {
    token: C.SOLANA_TEST_DIMO_TOKEN_ADDRESS,
    manager: "",
    transceiver: { wormhole: "" },
  },
};

export const WORMHOLE_TRANSCEIVER_INSTRUCTIONS = {
  relayed: "0x01000100",
  notRelayed: "0x01000101",
};

// TODO parse error messages with abi to give specific message
export const OnChainErrors = {
  "UserOperation reverted during simulation with reason: 0x15bdaac1": "Aftermarket device not claimed",
  "UserOperation reverted during simulation with reason: 0x762116ae": "Aftermarket device paired",
  "UserOperation reverted during simulation with reason: 0xe3ca9639": "Invalid node",
  "UserOperation reverted during simulation with reason: 0xc9134785": "Insufficient hex length",
  "UserOperation reverted during simulation with reason: 0xc46a5168": "Cannot burn paired vehicle",
};
