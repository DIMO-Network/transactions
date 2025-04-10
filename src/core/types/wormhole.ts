import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";

export type SupportedWormholeNetworks = "Ethereum" | "Polygon" | "Base" | "PolygonTest" | "BaseTest" | "SolanaTest";

export type NttContracts = {
  [key in SupportedWormholeNetworks]?: Ntt.Contracts;
};

export type BridgeInitiateArgs = {
  sourceChain: SupportedWormholeNetworks;
  destinationChain: SupportedWormholeNetworks;
  amount: bigint;
  recipientAddress: string;
  isRelayed?: boolean;
  priceIncreasePercentage?: number;
};
