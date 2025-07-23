import { NttContracts, SupportedWormholeNetworks } from ":core/types/wormhole.js";
import { Network, Chain } from "@wormhole-foundation/sdk";

import * as contractAddrs from ":core/constants/contractAddrs.js";

export const WORMHOLE_ENV_MAPPING = new Map<string, Network>([
  ["production", "Mainnet"],
  ["prod", "Mainnet"],

  ["production_test", "Mainnet"],
  ["prod_test", "Mainnet"],

  ["development", "Testnet"],
  ["dev", "Testnet"],
]);

export const WORMHOLE_CHAIN_MAPPING: Record<SupportedWormholeNetworks, Chain> = {
  Ethereum: "Ethereum",
  Polygon: "Polygon",
  Base: "Base",
  Solana: "Solana",
  Sepolia: "Sepolia",
  BaseSepolia: "BaseSepolia",
  PolygonSepolia: "PolygonSepolia",
  Amoy: "PolygonSepolia",
  SolanaTestnet: "Solana",
  EthereumTest: "Ethereum",
  PolygonTest: "Polygon",
  BaseTest: "Base",
  SolanaTest: "Solana",
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
  Sepolia: {
    token: contractAddrs.SEPOLIA_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.SEPOLIA_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.SEPOLIA_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  PolygonSepolia: {
    token: contractAddrs.POLYGON_SEPOLIA_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.POLYGON_SEPOLIA_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.POLYGON_SEPOLIA_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  Amoy: {
    token: contractAddrs.POLYGON_SEPOLIA_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.POLYGON_SEPOLIA_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.POLYGON_SEPOLIA_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  BaseSepolia: {
    token: contractAddrs.BASE_SEPOLIA_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.BASE_SEPOLIA_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.BASE_SEPOLIA_WORMHOLE_TRANSCEIVER_ADDRESS },
  },
  SolanaTestnet: {
    token: contractAddrs.SOLANA_TESTNET_DIMO_TOKEN_ADDRESS,
    manager: contractAddrs.SOLANA_TESTNET_WORMHOLE_NTT_MANAGER_ADDRESS,
    transceiver: { wormhole: contractAddrs.SOLANA_TESTNET_WORMHOLE_TRANSCEIVER_ADDRESS },
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