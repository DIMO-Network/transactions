import { Chain, polygon, polygonAmoy } from "viem/chains";

import { API_BY_ENV, AllChainInfos, ContractType, DIMO_APIs, ENVIRONMENT } from ":core/types/dimo.js";
import { abiForwarder } from ":core/abis/DimoForwarder.js";
import { abiVehicleId } from ":core/abis/DimoVehicleId.js";
import { abiRegistry } from ":core/abis/DimoRegistry.js";
import { abiCredits } from ":core/abis/DimoCredit.js";
import { abiToken } from ":core/abis/DimoToken.js";
import { abiSacd } from ":core/abis/DimoSacd.js";

import {
  AMOY_DIMO_CREDIT_ADDRESS,
  AMOY_DIMO_SACD_ADDRESS,
  AMOY_DIMO_VEHICLE_ID_ADDRESS,
  AMOY_DIMO_TOKEN_ADDRESS,
  AMOY_DIMO_REGISTRY_ADDRESS,
  POLYGON_DIMO_VEHICLE_ID_ADDRESS,
  POLYGON_DIMO_TOKEN_ADDRESS,
  POLYGON_DIMO_CREDIT_ADDRESS,
  POLYGON_DIMO_REGISTRY_ADDRESS,
  AMOY_DIMO_FORWARDER,
  POLYGON_DIMO_FORWARDER,
  POLYGON_DIMO_SACD_ADDRESS,
} from ":core/constants/contractAddrs.js";
import { Abi } from "viem";

export const ENV_NETWORK_MAPPING = new Map<ENVIRONMENT, Chain>([
  [ENVIRONMENT.PROD, polygon],
  [ENVIRONMENT.DEV, polygonAmoy],
]);

export const ENV_MAPPING = new Map<string, ENVIRONMENT>([
  ["production", ENVIRONMENT.PROD],
  ["prod", ENVIRONMENT.PROD],

  ["development", ENVIRONMENT.DEV],
  ["dev", ENVIRONMENT.DEV],
]);

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
};

export const CHAIN_ABI_MAPPING: AllChainInfos = {
  [ENVIRONMENT.DEV]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: AMOY_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits as Abi,
        address: AMOY_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: AMOY_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: AMOY_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: AMOY_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: AMOY_DIMO_FORWARDER,
      },
    },
  },
  [ENVIRONMENT.PROD]: {
    contracts: {
      [ContractType.DIMO_SACD]: {
        abi: abiSacd,
        address: POLYGON_DIMO_SACD_ADDRESS,
      },
      [ContractType.DIMO_CREDIT]: {
        abi: abiCredits,
        address: POLYGON_DIMO_CREDIT_ADDRESS,
      },
      [ContractType.DIMO_REGISTRY]: {
        abi: abiRegistry,
        address: POLYGON_DIMO_REGISTRY_ADDRESS,
      },
      [ContractType.DIMO_VEHICLE_ID]: {
        abi: abiVehicleId,
        address: POLYGON_DIMO_VEHICLE_ID_ADDRESS,
      },
      [ContractType.DIMO_TOKEN]: {
        abi: abiToken,
        address: POLYGON_DIMO_TOKEN_ADDRESS,
      },
      [ContractType.DIMO_FORWARDER]: {
        abi: abiForwarder,
        address: POLYGON_DIMO_FORWARDER,
      },
    },
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
