import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";

export type SupportedWormholeNetworks = "Ethereum" | "Polygon" | "Base" | "PolygonTest" | "BaseTest"

export type NttContracts = {
  [key in SupportedWormholeNetworks]?: Ntt.Contracts;
};
