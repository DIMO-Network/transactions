import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";

export type SupportedWormholeNetworks =
  | "Ethereum"
  | "Polygon"
  | "Base"
  | "Solana"
  | "Sepolia"
  | "BaseSepolia"
  | "PolygonSepolia"
  | "Amoy"
  | "SolanaTestnet"
  | "EthereumTest"
  | "PolygonTest"
  | "BaseTest"
  | "SolanaTest";

export type SupportedRelayingWormholeNetworks =
  | "Ethereum"
  | "Polygon"
  | "Base"
  | "Solana"
  | "Sepolia"
  | "BaseSepolia"
  | "SolanaTestnet"

export type NttContracts = {
  [key in SupportedWormholeNetworks]?: Ntt.Contracts;
};

// Define the type for RPC configuration
export type ChainRpcConfig = {
  [key in SupportedWormholeNetworks]?: {
    rpc: string;
  };
};

// Base type with common properties
type BaseBridgeInitiateArgs = {
  sourceChain: SupportedWormholeNetworks;
  destinationChain: SupportedWormholeNetworks;
  amount: bigint;
  recipientAddress: string;
  priceIncreasePercentage?: number;
  swapOptions?: {
    slippageTolerance?: number; // In basis points (e.g., 500 = 5%)
    deadline?: number; // Unix timestamp in seconds
  };
};

// Type for non-relayed transfers
type NonRelayedBridgeArgs = BaseBridgeInitiateArgs & {
  isRelayed?: false;
  rpcConfig?: ChainRpcConfig; // Optional for non-relayed transfers
};

// Type for relayed transfers
type RelayedBridgeArgs = BaseBridgeInitiateArgs & {
  isRelayed: true;
  rpcConfig: ChainRpcConfig; // Required for relayed transfers
  payWithDimo: boolean;
};

// Combined type
export type BridgeInitiateArgs = NonRelayedBridgeArgs | RelayedBridgeArgs;

// Base interface for API responses
export interface BaseWormholeResponse {
  operations?: Operation[];
  code?: number;
  message?: string;
  details?: Array<{
    request_id: string;
    [key: string]: any;
  }>;
}

// Wormhole API Vaa format
export interface Vaa {
  raw: string;
  guardianSetIndex: number;
  isDuplicated: boolean;
}

// Wormhole API Operation
export interface Operation {
  id: string;
  emitterChain: number;
  emitterAddress: {
    hex: string;
    native: string;
  };
  sequence: string;
  vaa?: Vaa
  content: {
    payload: {
      nttManagerMessage: {
        id: string;
        sender: string;
      };
      nttMessage: {
        additionalPayload: string;
        sourceToken: string;
        to: string;
        toChain: number;
        trimmedAmount: {
          amount: string;
          decimals: number;
        };
      };
      transceiverMessage: {
        prefix: string;
        recipientNttManager: string;
        sourceNttManager: string;
        transceiverPayload: string;
      };
    };
    standarizedProperties: {
      appIds: string[];
      fromChain: number;
      fromAddress: string;
      toChain: number;
      toAddress: string;
      tokenChain: number;
      tokenAddress: string;
      amount: string;
      feeAddress: string;
      feeChain: number;
      fee: string;
      normalizedDecimals: number;
    };
  };
  sourceChain?: {
    chainId: number;
    timestamp: string;
    transaction: {
      txHash: string;
    };
    from: string;
    status: string;
    fee: string;
    gasTokenNotional: string;
    feeUSD: string;
  };
  targetChain?: {
    chainId: number;
    timestamp: string;
    transaction: {
      txHash: string;
    };
    status: string;
    from: string;
    to: string;
    fee: string;
    gasTokenNotional: string;
    feeUSD: string;
  };
}

export interface WormholeErrorResponse extends BaseWormholeResponse {
  code: number;
  message: string;
}