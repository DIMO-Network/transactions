import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";

export type SupportedWormholeNetworks = "Ethereum" | "Polygon" | "Base" | "PolygonTest" | "BaseTest" | "SolanaTest";

export type NttContracts = {
  [key in SupportedWormholeNetworks]?: Ntt.Contracts;
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
  }
};

// Type for non-relayed transfers
type NonRelayedBridgeArgs = BaseBridgeInitiateArgs & {
  isRelayed?: false;
  rpcUrl?: string; // Optional for non-relayed transfers
};

// Type for relayed transfers
type RelayedBridgeArgs = BaseBridgeInitiateArgs & {
  isRelayed: true;
  rpcUrl: string; // Required for relayed transfers
};

// Combined type
export type BridgeInitiateArgs = NonRelayedBridgeArgs | RelayedBridgeArgs;