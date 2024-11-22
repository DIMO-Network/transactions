import { encodeFunctionData } from "viem";
import { KernelAccountClient } from "@zerodev/sdk";
import { TransactionData } from ":core/types/args.js";

export const executeTransaction = async (
  args: TransactionData,
  client: KernelAccountClient
): Promise<`0x${string}`> => {
  return await client.account!.encodeCalls([
    {
      to: args.address,
      value: args.value as bigint,
      data: encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
      }),
    },
  ]);
};

export const executeTransactionBatch = async (
  args: TransactionData[],
  client: KernelAccountClient
): Promise<`0x${string}`> => {
  const callData = args.map((arg) => {
    return {
      to: arg.address,
      value: arg.value as bigint,
      data: encodeFunctionData({
        abi: arg.abi,
        functionName: arg.functionName,
        args: arg.args,
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
};
