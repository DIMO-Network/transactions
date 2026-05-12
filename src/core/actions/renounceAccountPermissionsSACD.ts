import { encodeFunctionData } from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { RENOUNCE_ACCOUNT_PERMISSIONS_SACD } from ":core/constants/methods.js";
import { RenounceAccountPermissions } from ":core/types/args.js";

export async function renounceAccountPermissions(
  args: RenounceAccountPermissions,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: RENOUNCE_ACCOUNT_PERMISSIONS_SACD,
        args: [args.grantor],
      }),
    },
  ]);
}

export function renounceAccountPermissionsCallData(
  args: RenounceAccountPermissions,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SACD].abi,
    functionName: RENOUNCE_ACCOUNT_PERMISSIONS_SACD,
    args: [args.grantor],
  });
}

export async function renounceAccountPermissionsBatch(
  args: RenounceAccountPermissions[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const callData = args.map((arg) => {
    return {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: RENOUNCE_ACCOUNT_PERMISSIONS_SACD,
        args: [arg.grantor],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}
