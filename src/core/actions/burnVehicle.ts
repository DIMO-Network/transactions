import { Chain, Transport, encodeFunctionData } from "viem";
import { ContractType, ENVIRONMENT, KernelConfig } from ":core/types/dimo.js";
import { BURN_VEHICLE } from ":core/constants/methods.js";
import { KernelAccountClient, KernelSmartAccount } from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { BurnVehicle } from ":core/types/args.js";
import { GetUserOperationReceiptReturnType } from "permissionless";
import { PasskeyStamper } from "@turnkey/react-native-passkey-stamper";
import { KernelEncodeCallDataArgs } from "@zerodev/sdk/types";
import { executeTransaction } from ":core/transactions/execute.js";

export function burnVehicleCallData(args: BurnVehicle, environment: string = "prod"): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
    functionName: BURN_VEHICLE,
    args: [args.tokenId],
  });
}

export const burnVehicleTransaction = async (
  args: BurnVehicle,
  subOrganizationId: string,
  walletAddress: string,
  passkeyStamper: PasskeyStamper,
  config: KernelConfig
): Promise<GetUserOperationReceiptReturnType> => {
  const env = ENV_MAPPING.get(config.environment ?? "prod") ?? ENVIRONMENT.PROD;
  const contracts = CHAIN_ABI_MAPPING[env].contracts;

  const sendDIMOCallData = burnVehicleCallData(args, config.environment);

  const txData: KernelEncodeCallDataArgs = {
    callType: "call",
    to: contracts[ContractType.DIMO_VEHICLE_ID].address,
    value: BigInt("0"),
    data: sendDIMOCallData,
  };

  const resp = await executeTransaction(subOrganizationId, walletAddress, txData, passkeyStamper, config);

  return resp;
};

export async function burnVehicle(
  args: BurnVehicle,
  client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  return await client.account.encodeCallData({
    to: contracts[ContractType.DIMO_VEHICLE_ID].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
      functionName: BURN_VEHICLE,
      args: [args.tokenId],
    }),
  });
}

// Burn Vehicle-- cant burn if you still have AD attached
// 0xc46a516800000000000000000000000000000000000000000000000000000000000000f6
