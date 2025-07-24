import { Chain } from "@wormhole-foundation/sdk";
import { BaseWormholeResponse, NttContracts, WormholeErrorResponse, type Operation } from ":core/types/wormhole.js";
import { NttExecutorRoute } from "@wormhole-foundation/sdk-route-ntt";

/**
 * Converts NttContracts to NttExecutorRoute.Config format.
 *
 * @param nttContracts - An object containing NTT contract addresses for each chain.
 * @returns A configuration object for NttExecutorRoute, containing the NTT tokens and their respective executor tokens.
 *
 * @remarks
 * This function takes an object of NttContracts and converts it into a format suitable for use with the NttExecutorRoute.
 * It filters out any undefined contracts, maps the contract addresses to the required format, and adds a quoter if it exists.
 *
 * @example
 * ```typescript
 * const nttContracts: NttContracts = {
 *   Solana: {
 *     token: "0x123...",
 *     manager: "0x456...",
 *     transceiver: {
 *       wormhole: "0x789..."
 *     },
 *     quoter: "0xabc..."
 *   },
 *   Polygon: {
 *     token: "0xdef...",
 *     manager: "0xghi...",
 *     transceiver: {
 *       wormhole: "0xijk..."
 *     }
 *   }
 * };
 *
 * const executorConfig = convertToExecutorConfig(nttContracts);
 * console.log(executorConfig);
 * ```
 */
export function convertToExecutorConfig(nttContracts: NttContracts): NttExecutorRoute.Config {
  const tokenName: string = "MyToken";
  const tokens = Object.entries(nttContracts)
    .filter(([_, contracts]) => contracts !== undefined)
    .map(([chain, contracts]) => {
      const executorToken = {
        chain: chain as Chain,
        token: contracts!.token,
        manager: contracts!.manager,
        transceiver: Object.entries(contracts!.transceiver).map(([type, address]) => ({
          type: type as "wormhole",
          address: address as string,
        })),
      };
      // Add quoter if it exists
      if ('quoter' in contracts! && contracts!.quoter) {
        (executorToken as any).quoter = contracts!.quoter;
      }
      return executorToken;
    });

  return {
    ntt: {
      tokens: {
        [tokenName]: tokens
      }
    }
  };
}

/**
 * Determines the status of a Wormhole operation based on its properties.
 *
 * @param operation - The Wormhole operation object to evaluate
 * @returns A string representing the current status of the operation:
 *   - 'Completed': The operation has reached its destination chain
 *   - 'Emitted': The operation has a VAA (Verified Action Approvals) but hasn't reached the destination chain
 *   - 'In Progress': The operation has been initiation in the source chain, but no VAA yet
 *   - 'Unknown': The operation doesn't have enough information to determine its status
 */
export function getOperationStatus(operation: Operation): string {
  if (operation.targetChain) {
    return 'Completed';
  } else if (operation.vaa) {
    return 'Emitted';
  } else if (operation.sourceChain) {
    return 'In Progress';
  } else {
    return 'Unknown';
  }
}

export function isWormholeErrorResponse(response: BaseWormholeResponse): response is WormholeErrorResponse {
  return response.code !== undefined && response.message !== undefined;
}