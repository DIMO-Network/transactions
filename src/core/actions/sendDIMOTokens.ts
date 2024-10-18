import {
  Account,
  Address,
  Chain,
  ParseAccount,
  PublicClient,
  RpcSchema,
  TransactionRequest,
  Transport,
  WalletClient,
  encodeFunctionData,
} from "viem";
import { ContractType, ENVIRONMENT, KernelConfig, _kernelConfig } from ":core/types/dimo.js";
import { SEND_DIMO_TOKENS } from ":core/constants/methods.js";
import { KernelAccountClient, KernelSmartAccount } from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { SendDIMOTokens } from ":core/types/args.js";
import { GetUserOperationReceiptReturnType } from "permissionless";
import { KernelEncodeCallDataArgs } from "@zerodev/sdk/types";
import { executeTransaction } from ":core/transactions/execute.js";
import { polygon } from "viem/chains";

export function sendDIMOTokensCallData(args: SendDIMOTokens, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_TOKEN].abi,
    functionName: SEND_DIMO_TOKENS,
    args: [args.recipient, args.amount],
  });
}

export const sendDIMOTransaction = async (
  args: SendDIMOTokens,
  subOrganizationId: string,
  walletAddress: string,
  passkeyStamper: any,
  config: KernelConfig
): Promise<GetUserOperationReceiptReturnType> => {
  const _config = config as _kernelConfig;
  const env = ENV_MAPPING.get(_config.environment) ?? ENVIRONMENT.PROD;
  const contracts = CHAIN_ABI_MAPPING[env].contracts;

  const sendDIMOCallData = sendDIMOTokensCallData(args, config.environment);

  const txData: KernelEncodeCallDataArgs = {
    callType: "call",
    to: contracts[ContractType.DIMO_TOKEN].address,
    value: BigInt("0"),
    data: sendDIMOCallData,
  };

  const resp = await executeTransaction(subOrganizationId, walletAddress, txData, passkeyStamper, _config);

  return resp;
};

export async function sendDIMOTokens(
  args: SendDIMOTokens,
  client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account.encodeCallData({
    to: contracts[ContractType.DIMO_TOKEN].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_TOKEN].abi,
      functionName: SEND_DIMO_TOKENS,
      args: [args.recipient, args.amount],
    }),
  });
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
