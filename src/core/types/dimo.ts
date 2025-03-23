import { EntryPointType, KERNEL_V2_VERSION_TYPE, KERNEL_V3_VERSION_TYPE } from "@zerodev/sdk/types";
import { SACD_PERMISSIONS } from "src/index.js";
import { Account } from "viem";
import { EntryPointVersion, GetUserOperationReceiptReturnType } from "viem/account-abstraction";
import { Chain, polygon, polygonAmoy } from "viem/chains";

import { AbiAddressPair } from "./common.js";

export const SUPPORTED_CHAINS: Chain[] = [polygonAmoy, polygon];

export type KernelConfig = {
  rpcUrl: string;
  bundlerUrl: string;
  paymasterUrl: string;
  clientId: string;
  domain: string;
  redirectUri: string;
  turnkeyApiBaseUrl?: string;
  entryPoint?: EntryPointType<EntryPointVersion>;
  kernelVersion?: KERNEL_V3_VERSION_TYPE;
  environment?: string;
  useWalletSession?: boolean; // depricate?
  sessionTimeoutSeconds?: string; // seconds
  usePrivateKey?: boolean;
  defaultPermissions?: SACD_PERMISSIONS;
  subOrganizationId?: string;
  stamper?: any;
  feeBoostConfig?: FeeBoostConfig;
};

export type _kernelConfig = {
  rpcUrl: string;
  bundlerUrl: string;
  paymasterUrl: string;
  turnkeyApiBaseUrl: string;
  entryPoint: EntryPointType<EntryPointVersion>;
  kernelVersion: KERNEL_V3_VERSION_TYPE;
  environment: string;
  useWalletSession: boolean;
  sessionTimeoutSeconds: string;
  usePrivateKey: boolean;
  clientId: string;
  domain: string;
  redirectUri: string;
  defaultPermissions: SACD_PERMISSIONS;
  feeBoostConfig: FeeBoostConfig;
};

export type FeeBoostConfig = {
  maxFeePerGasPercent: number;
  maxPriorityFeePerGasPercent: number;
};

export type AccountConfig = {
  rpcUrl: string;
  account: Account;
  environment?: string;
};

export type _accountConfig = {
  rpcUrl: string;
  account: Account;
  environment: string;
};

export type PasskeySignerConfig = {
  rpcURL: string;
  bundlerUrl: string;
  paymasterUrl: string;
  turnkeyApiBaseUrl: string;
  entryPoint: EntryPointType<EntryPointVersion>;
  kernelVersion: KERNEL_V3_VERSION_TYPE | KERNEL_V2_VERSION_TYPE;
  environment: string;
  subOrganizationId: string;
  walletAddress: string;
  rpId: string;
};

export enum ContractType {
  DIMO_CREDIT,
  DIMO_REGISTRY,
  DIMO_VEHICLE_ID,
  DIMO_SACD,
  DIMO_TOKEN,
  DIMO_FORWARDER,
  DIMO_STAKING,
}

export enum SupportedNetworks {
  AMOY,
  POLYGON,
}

export enum ENVIRONMENT {
  PROD,
  DEV,
  PROD_TEST
}

export enum DIMO_APIs {
  ATTESTATION,
  AUTH,
  IDENTITY,
  DEVICES,
  DEVICE_DATA,
  DEVICE_DEFINITIONS,
  EVENTS,
  TELEMETRY,
  TOKEN_EXCHANGE,
  TRIPS,
  USER,
  VALUATIONS,
  VEHICLE_SIGNAL_DECODING,
  IPFS,
}

export type API_BY_ENV = {
  [key in ENVIRONMENT]: {
    [key in DIMO_APIs]: {
      url: string;
    };
  };
};

export type ApiInfos = {
  [key in ENVIRONMENT]: DIMO_APIs;
};

export type AllChainInfos = {
  [key in ENVIRONMENT]: ChainInfos;
};

export type ChainInfos = {
  contracts: ContractToMapping;
};

export type ContractToMapping = {
  [key in ContractType]: AbiAddressPair;
};

export type SACDTemplate = {
  specVersion: string;
  id: string;
  type: string;
  datacontentype: string;
  time: string;
  data: {
    templateId: string;
    version: string;
    grantor: string;
    grantee: string;
    scope: {
      permissions: string[];
    };
    effectiveAt: string;
    expiresAt: string;
    attachments: string[];
    description: string;
  };
};

export type SACDTemplateSigned = {
  specVersion: string;
  id: string;
  type: string;
  datacontentype: string;
  time: string;
  "com.dimo.grantor.signature": string;
  data: {
    templateId: string;
    version: string;
    grantor: string;
    grantee: string;
    scope: {
      permissions: string[];
    };
    effectiveAt: string;
    expiresAt: string;
    attachments: string[];
    description: string;
  };
};

export type TransactionReturnType = GetUserOperationReceiptReturnType & {
  userOperationHash?: string;
  status?: string;
};

export type OptionalArgs = {
  feeBoostConfig: FeeBoostConfig;
};
