import { ENVIRONMENT, KernelConfig } from ":core/types/dimo.js";
import { createPublicClient, http } from "viem";
import { GetUserOperationReceiptReturnType, createBundlerClient } from "permissionless";
import { ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import { TurnkeyClient } from "@turnkey/http";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk";
import { KernelEncodeCallDataArgs } from "@zerodev/sdk/types";
import { walletClientToSmartAccountSigner } from "permissionless/utils";
import { createWalletClient } from "viem";
import { polygon } from "viem/chains";
import { createAccount } from "@turnkey/viem";

export const executeTransaction = async (
  subOrganizationId: string,
  walletAddress: string,
  transactionData: KernelEncodeCallDataArgs,
  passkeyStamper: any,
  config: KernelConfig
): Promise<GetUserOperationReceiptReturnType> => {
  const env = ENV_MAPPING.get(config.environment ?? "prod") ?? ENVIRONMENT.PROD;
  const chain = ENV_NETWORK_MAPPING.get(env) ?? polygon;

  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });

  const passkeyStamperClient = new TurnkeyClient(
    { baseUrl: config.turnkeyApiBaseUrl ?? "https://api.turnkey.com" },
    passkeyStamper
  );

  const localAccount = await createAccount({
    // @ts-ignore
    client: passkeyStamperClient,
    organizationId: subOrganizationId,
    signWith: walletAddress,
    ethereumAddress: walletAddress,
  });

  const smartAccountClient = createWalletClient({
    account: localAccount,
    chain: chain,
    transport: http(config.rpcUrl),
  });
  const smartAccountSigner = walletClientToSmartAccountSigner(smartAccountClient);
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: smartAccountSigner,
    entryPoint: config.entryPoint,
    // @ts-ignore
    kernelVersion: config.kernelVersion,
  });

  const account = await createKernelAccount(publicClient, {
    plugins: {
      sudo: ecdsaValidator,
    },
    entryPoint: config.entryPoint,
    // @ts-ignore
    kernelVersion: config.kernelVersion,
  });

  const kernelClient = createKernelAccountClient({
    account,
    chain,
    entryPoint: config.entryPoint,
    bundlerTransport: http(config.bundlerUrl),
    middleware: {
      // @ts-ignore
      sponsorUserOperation: async ({ userOperation }) => {
        const zerodevPaymaster = createZeroDevPaymasterClient({
          chain,
          entryPoint: config.entryPoint,
          transport: http(config.paymasterUrl),
        });
        return zerodevPaymaster.sponsorUserOperation({
          userOperation,
          entryPoint: config.entryPoint,
        });
      },
    },
  });

  const bundlerClient = createBundlerClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const callData = await kernelClient.account.encodeCallData(transactionData);
  const txHash = await kernelClient.sendUserOperation({
    // @ts-ignore
    account: kernelClient.account,
    userOperation: {
      callData,
    },
  });

  const resp = await bundlerClient.waitForUserOperationReceipt({
    hash: txHash,
  });

  return resp;
};
