import { EntryPointType, KERNEL_V2_VERSION_TYPE, KERNEL_V3_VERSION_TYPE } from "@zerodev/sdk/types";
import { Account } from "viem";
import { EntryPointVersion, GetUserOperationReceiptReturnType } from "viem/account-abstraction";
import { Chain, polygon, polygonAmoy } from "viem/chains";

import { AbiAddressPair } from "./common.js";
import { Permission } from ":core/types/args.js";

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
  defaultPermissions?: Permission[];
  subOrganizationId?: string;
  stamper?: any;
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
  defaultPermissions: Permission[];
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
  UNISWAP_V3_POOL,
}

export enum SupportedNetworks {
  AMOY,
  POLYGON,
}

export enum ENVIRONMENT {
  PROD,
  DEV,
  PROD_TEST,
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

interface CloudEventSACDAgreement {
  type: "cloudevent";
  eventType: string;
  source: `0x${string}`;
  asset: `did:${string}`;
  ids: string[];
  effectiveAt: string;
  expiresAt: string;
  extensions: {
    [key: string]: unknown;
  };
};

interface PaymentSACDAgreement {
  type: "payment";
  asset: `did:${string}`;
  payment: {
    amount: string;
    recurrence: "one-time" | "recurring";
    terms: {
      initialPayment: string;
      paymentMethod: "direct transfer" | "crypto transfer";
    };
  };
  purpose: string;
  attachments: {
    name: string;
    description: string;
    contentType: string;
    uri: string;
  }[];
  extensions?: {
    invoicing: {
      invoiceFrequency: "one-time" | "recurring";
      invoiceRecipient: string;
    }
  };
};

interface PermissionSACDAgreement {
  type: "permission";
  asset: `did:${string}`;
  permissions: {
    name: string;
    description?: string;
  }[];
  attachments: {
    [key: string]: unknown;
  }[];
  extensions?: {
    [key: string]: unknown;
  };
};

// Union type for SACD agreements, this way we can have different types of agreements in the same SACD and will rise type errors if the structure is not correct
type SACDAgreement = CloudEventSACDAgreement | PaymentSACDAgreement | PermissionSACDAgreement;

export type SACDTemplate = {
  specVersion: string;
  time: string;
  type: "dimo.sacd";
  data: {
    grantor: {
      address: `0x${string}`;
      name?: string;
    };
    grantee: {
      address: `0x${string}`;
      name?: string;
    };
    effectiveAt: string;
    expiresAt: string;
    additionalDates: {
      [key: string]: unknown;
    };
    agreements: SACDAgreement[];
  };
  signature: `0x${string}`;
};

export type TransactionReturnType = GetUserOperationReceiptReturnType & {
  userOperationHash?: string;
  status?: string;
};
