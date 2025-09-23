import { KernelAccountClient } from "@zerodev/sdk";
import {
  Account,
  Address,
  Chain,
  encodeFunctionData,
  ParseAccount,
  PublicClient,
  RpcSchema,
  TransactionRequest,
  Transport,
  WalletClient,
} from "viem";
import { polygon } from "viem/chains";

import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { SEND_DIMO_TOKENS } from ":core/constants/methods.js";
import { SendDIMOTokens } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export function sendDIMOTokensCallData(args: SendDIMOTokens, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_TOKEN].abi,
    functionName: SEND_DIMO_TOKENS,
    args: [args.recipient, args.amount],
  });
}

export async function sendDIMOTokens(
  args: SendDIMOTokens,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_TOKEN].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_TOKEN].abi,
        functionName: SEND_DIMO_TOKENS,
        args: [args.recipient, args.amount],
      }),
    },
  ]);
}

export async function sendDIMOTokensFromAccount(
  args: SendDIMOTokens,
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_TOKEN].address,
    abi: contracts[ContractType.DIMO_TOKEN].abi,
    functionName: SEND_DIMO_TOKENS,
    args: [args.recipient, args.amount],
    account: walletClient.account,
  });

  const txHash = await walletClient.writeContract(request);
  return txHash;
}

export async function sendDIMOTokensTransactionForSignature(
  args: SendDIMOTokens,
  publicClient: PublicClient,
  walletClient: WalletClient,
  senderAddress: `0x${string}`,
  environment: string = "prod"
): Promise<TransactionRequest> {
  const chain = ENV_NETWORK_MAPPING.get(ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD) ?? polygon;
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const gas = await publicClient.estimateFeesPerGas();
  const gaslimit = await publicClient.getGasPrice();
  const gasPrice = await publicClient.estimateContractGas({
    address: contracts[ContractType.DIMO_TOKEN].address,
    abi: contracts[ContractType.DIMO_TOKEN].abi,
    functionName: SEND_DIMO_TOKENS,
    args: [args.recipient, args.amount],
    account: senderAddress,
  });
  const callData = sendDIMOTokensCallData(args, environment);
  const nonce = await publicClient.getTransactionCount({ address: senderAddress });
  const preparedTransaction = await walletClient.prepareTransactionRequest({
    to: contracts[ContractType.DIMO_TOKEN].address,
    nonce: nonce,
    data: callData,
    gas: gasPrice,
    gasLimit: gaslimit,
    maxPriorityFeePerGas: gas.maxPriorityFeePerGas,
    maxFeePerGas: gas.maxFeePerGas,
    chain: chain,
  });

  return preparedTransaction as TransactionRequest;
}
