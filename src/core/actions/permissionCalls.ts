import { encodeFunctionData } from "viem";
import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { SET_ACCOUNT_PERMISSIONS_SACD, SET_PERMISSIONS_SACD } from ":core/constants/methods.js";
import { SetAccountPermissions, SetVehiclePermissions, SetVehiclePermissionsBulk } from ":core/types/args.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";
import { getPermissionsValue } from ":core/utils/utils.js";

/** One call of a smart-account batch, as `encodeCalls` and UserOperation `calls` take it. */
export type PermissionCall = { to: `0x${string}`; value: bigint; data: `0x${string}` };

function contractsFor(environment: string) {
  return CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;
}

/** SACD `setPermissions` calls for one or more vehicles, one call per entry. */
export function vehiclePermissionsCalls(
  args: SetVehiclePermissions | SetVehiclePermissions[],
  environment: string = "prod"
): PermissionCall[] {
  const contracts = contractsFor(environment);
  return (Array.isArray(args) ? args : [args]).map((arg) => ({
    to: contracts[ContractType.DIMO_SACD].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_SACD].abi,
      functionName: SET_PERMISSIONS_SACD,
      args: [
        contracts[ContractType.DIMO_VEHICLE_ID].address,
        arg.tokenId,
        arg.grantee,
        getPermissionsValue(arg.permissions),
        arg.expiration,
        arg.templateId ?? BigInt(0),
        arg.source,
      ],
    }),
  }));
}

/** SACD `setPermissions` calls granting the same permissions on every token id, one call per token. */
export function vehiclePermissionsBulkCalls(
  args: SetVehiclePermissionsBulk,
  environment: string = "prod"
): PermissionCall[] {
  return vehiclePermissionsCalls(
    args.tokenIds.map((tokenId) => ({
      tokenId,
      grantee: args.grantee,
      permissions: args.permissions,
      expiration: args.expiration,
      templateId: args.templateId,
      source: args.source,
    })),
    environment
  );
}

/** SACD `setAccountPermissions` calls for one or more grants, one call per entry. */
export function accountPermissionsCalls(
  args: SetAccountPermissions | SetAccountPermissions[],
  environment: string = "prod"
): PermissionCall[] {
  const contracts = contractsFor(environment);
  return (Array.isArray(args) ? args : [args]).map((arg) => ({
    to: contracts[ContractType.DIMO_SACD].address,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: contracts[ContractType.DIMO_SACD].abi,
      functionName: SET_ACCOUNT_PERMISSIONS_SACD,
      args: [arg.grantee, getPermissionsValue(arg.permissions), arg.expiration, arg.templateId, arg.source],
    }),
  }));
}
