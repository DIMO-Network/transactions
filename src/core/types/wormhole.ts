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
