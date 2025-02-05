import { Ntt } from "@wormhole-foundation/sdk-definitions-ntt";
import { Chain } from "@wormhole-foundation/sdk";

import { AbiAddressPair } from "./common.js";

export type NttContracts = {
  [key in Chain]?: Ntt.Contracts;
};

export enum SupportedWormholeNetworks {
  MAINNET,
  POLYGON,
  BASE,
  POLYGON_TEST,
  BASE_TEST,
}

export type WormholeNttManagerMapping = {
  [key in SupportedWormholeNetworks]: AbiAddressPair;
};