import { Token } from "@uniswap/sdk-core";

import { ENVIRONMENT } from ":core/types/dimo.js";

export type UniswapMappingArgs = {
  [key in ENVIRONMENT]: {
    dimoToken: Token;
    uniswapV3Pool: string;
    poolFee: number;
  };
};
