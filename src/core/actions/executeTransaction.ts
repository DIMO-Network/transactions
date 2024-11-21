import { Chain, Transport, encodeFunctionData } from "viem";
import { KernelAccountClient, KernelSmartAccount } from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { TransactionData } from ":core/types/args.js";

export const executeTransaction = async (
  args: TransactionData,
  client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>
): Promise<`0x${string}`> => {
  return await client.account.encodeCallData({
    to: args.address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: args.abi,
      functionName: args.functionName,
      args: args.args,
    }),
  });
};

export const executeTransactionBatch = async (
  args: TransactionData[],
  client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>
): Promise<`0x${string}`> => {
  const callData = args.map((arg) => {
    return {
      to: arg.address,
      value: arg.value,
      data: encodeFunctionData({
        abi: arg.abi,
        functionName: arg.functionName,
        args: arg.args,
      }),
    };
  });

  return await client.account.encodeCallData(callData);
};
