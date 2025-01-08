import { encodeFunctionData } from "viem";
import { Wormhole, chainToChainId } from "@wormhole-foundation/sdk";
import { KernelAccountClient } from "@zerodev/sdk";
import evm from "@wormhole-foundation/sdk/platforms/evm";

import { addressToBytes32 } from ":core/utils/utils.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { APPROVE_TOKENS, NTT_TRANSFER } from ":core/constants/methods.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, WORMHOLE_ENV_MAPPING, WORMHOLE_NTT_CONTRACTS, WORMHOLE_TRANSCEIVER_INSTRUCTIONS } from ":core/constants/mappings.js";

import { abiWormholeNttManager } from ":core/abis/WormholeNttManager.js";

type SupportedChain = 'Ethereum' | 'Polygon' | 'Base';

interface BridgeInitiateArgs {
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  tokenAddress: string;
  amount: bigint;
  recipientAddress: string;
  isRelayed?: boolean;
  test?: boolean;
}

export async function initiateBridging(
  args: BridgeInitiateArgs,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<string> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const sourceNttManagerAddress = WORMHOLE_NTT_CONTRACTS[args.sourceChain]?.manager;
  const wormhole = new Wormhole(WORMHOLE_ENV_MAPPING.get(environment) ?? "Testnet", [evm.Platform, evm.Platform]);
  const sourceChain = wormhole.getChain(args.sourceChain);
  const destChain = wormhole.getChain(args.destinationChain);

  const srcNtt = await sourceChain.getProtocol("Ntt", {
    ntt: WORMHOLE_NTT_CONTRACTS[args.sourceChain],
  });

  let transferCallValue = BigInt(0);
  let transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.notRelayed;

  if (args.isRelayed) {
    transferCallValue = await srcNtt.quoteDeliveryPrice(destChain.chain, {
      queue: false,
      automatic: true
    });
    // Increase transferCallValue by 10% to avoid underfunding
    transferCallValue = transferCallValue + (transferCallValue * BigInt(10) / BigInt(100))
    transceiverInstructions = WORMHOLE_TRANSCEIVER_INSTRUCTIONS.relayed;
  }

  const approveCall = {
    to: contracts[ContractType.DIMO_TOKEN].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_TOKEN].abi,
      functionName: APPROVE_TOKENS,
      args: [sourceNttManagerAddress, args.amount],
    }),
  };

  const transferCall = {
    to: sourceNttManagerAddress as `0x${string}`,
    value: transferCallValue,
    data: encodeFunctionData({
      abi: abiWormholeNttManager,
      functionName: NTT_TRANSFER,
      /* uint256 amount,uint16 recipientChain,bytes32 recipient,bytes32 refundAddress,bool shouldQueue,bytes transceiverInstructions */
      args: [
        args.amount,
        chainToChainId(args.destinationChain),
        addressToBytes32(args.recipientAddress),
        addressToBytes32(client.account?.address as string),
        false,
        transceiverInstructions
      ],
    }),
  };

  return await client.account!.encodeCalls([approveCall, transferCall]);
}