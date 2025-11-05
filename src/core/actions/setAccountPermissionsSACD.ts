import { encodeFunctionData } from "viem";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { KernelAccountClient } from "@zerodev/sdk";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { SET_ACCOUNT_PERMISSIONS_SACD } from ":core/constants/methods.js";
import { SetAccountPermissions } from ":core/types/args.js";
import { getPermissionsValue } from ":core/utils/utils.js";

/**
 * Sets account-level permissions for a grantee with template support
 */
export async function setAccountPermissions(
  args: SetAccountPermissions,
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const permissionValue = getPermissionsValue(args.permissions);

  return await client.account!.encodeCalls([
    {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_ACCOUNT_PERMISSIONS_SACD,
        args: [args.grantee, permissionValue, args.expiration, args.templateId, args.source],
      }),
    },
  ]);
}

/**
 * Generates call data for setting account permissions
 */
export function setAccountPermissionsCallData(
  args: SetAccountPermissions,
  environment: string = "prod"
): `0x${string}` {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  const permissionValue = getPermissionsValue(args.permissions);
  
  return encodeFunctionData({
    abi: contracts[ContractType.DIMO_SACD].abi,
    functionName: SET_ACCOUNT_PERMISSIONS_SACD,
    args: [args.grantee, permissionValue, args.expiration, args.templateId, args.source],
  });
}

/**
 * Batch sets account-level permissions for multiple grantees or configurations
 */
export async function setAccountPermissionsBatch(
  args: SetAccountPermissions[],
  client: KernelAccountClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
  
  const callData = args.map((arg) => {
    const permissionValue = getPermissionsValue(arg.permissions);

    return {
      to: contracts[ContractType.DIMO_SACD].address,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: contracts[ContractType.DIMO_SACD].abi,
        functionName: SET_ACCOUNT_PERMISSIONS_SACD,
        args: [arg.grantee, permissionValue, arg.expiration, arg.templateId, arg.source],
      }),
    };
  });

  return await client.account!.encodeCalls(callData);
}
