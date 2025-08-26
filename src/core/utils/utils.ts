import { pad, isAddress } from "viem";
import { MAX_PERMISSION_INDEX, Permission, VehiclePermissionDescription } from ":core/types/args.js";
import { AccountConfig, KernelConfig, _accountConfig, _kernelConfig } from ":core/types/dimo.js";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";

export const newKernelConfig = (args: KernelConfig): KernelConfig => {
  if (args.rpcUrl == undefined) {
    throw new Error("rpcUrl is required");
  }

  if (args.bundlerUrl == undefined) {
    throw new Error("bundlerUrl is required");
  }

  if (args.paymasterUrl == undefined) {
    throw new Error("paymasterUrl is required");
  }

  if (args.turnkeyApiBaseUrl == undefined) {
    args.turnkeyApiBaseUrl = "https://api.turnkey.com";
  }

  if (args.entryPoint == undefined) {
    args.entryPoint = getEntryPoint("0.7");
  }

  if (args.kernelVersion == undefined) {
    args.kernelVersion = KERNEL_V3_1;
  }

  if (args.environment == undefined) {
    args.environment = "prod";
  }

  if (args.useWalletSession == undefined) {
    args.useWalletSession = false;
  }

  if (args.sessionTimeoutSeconds == undefined) {
    args.sessionTimeoutSeconds = "900";
  }

  if (args.usePrivateKey == undefined) {
    args.usePrivateKey = false;
  }

  if (args.defaultPermissions == undefined) {
    const defaultPerms: Permission[] = [];
    args.defaultPermissions = defaultPerms;
  }

  return {
    rpcUrl: args.rpcUrl,
    bundlerUrl: args.bundlerUrl,
    paymasterUrl: args.paymasterUrl,
    clientId: args.clientId,
    domain: args.domain,
    redirectUri: args.redirectUri,
    turnkeyApiBaseUrl: args.turnkeyApiBaseUrl,
    entryPoint: args.entryPoint,
    kernelVersion: args.kernelVersion,
    environment: args.environment,
    useWalletSession: args.useWalletSession,
    sessionTimeoutSeconds: args.sessionTimeoutSeconds,
    usePrivateKey: args.usePrivateKey,
    defaultPermissions: args.defaultPermissions
  };
};

export const newAccountConfig = (args: AccountConfig): _accountConfig => {
  if (args.account === undefined) {
    throw new Error("Account is required");
  }

  if (args.rpcUrl === undefined) {
    throw new Error("rpcURL is required");
  }

  if (args.environment === undefined) {
    args.environment = "prod";
  }

  return {
    rpcUrl: args.rpcUrl,
    account: args.account,
    environment: args.environment,
  };
};

export const getPermissionsValue = (permissions: Permission[]): bigint => {
  const present = new Set(permissions);
  const allPermissions = Object.values(Permission).filter(p => typeof p === 'number') as number[];
  allPermissions.sort((a, b) => a - b);

  const encodedPermissions = allPermissions.map(p => present.has(p) ? '11' : '00').reverse();

  return BigInt(`0b${encodedPermissions.join("")}00`);
};

export const getPermissionsArray = (permissionValue: bigint): Permission[] => {
  const bin = permissionValue.toString(2).padStart(18, '0');
  const bits = bin.slice(0, -2);

  const permissions: Permission[] = [];

  for (let i = 0; i < bits.length; i += 2) {
    const chunk = bits.slice(i, i + 2);
    const indexFromEnd = i / 2;
    const permissionEnumValue = MAX_PERMISSION_INDEX - indexFromEnd;
    if (chunk === '11') {
      permissions.push(permissionEnumValue as Permission);
    }
  }

  return permissions.reverse();
}


export const sacdDescription = (args: VehiclePermissionDescription): string => {
  const description = `By proceeding, you will grant data access and control functions to ${args.appName} effective as of ${args.effectiveAt} until ${new Date(Number(args.expiration) * 1000).toISOString()}. Permissions being granted: ${args.permissionArray.join("; ")} Driver ID: ${args.driverID} App ID: ${args.appID} DIMO Platform, version 1.0.`;
  return description;
};


// | APPROX LOCATION | RAW DATA | STREAMS | CREDENTIALS | ALLTIME_LOCATION | CURRENT_LOCATION | COMMANDS | NONLOCATION_TELEMETRY | ZERO-PADDED |
// |-----------------|----------|---------|-------------|------------------|------------------|----------|-----------------------|-------------|
// |      11         |   11     |   11    |     11      |       11         |       11         |    11    |          11           |     00      |  262140n
// |-----------------|----------|---------|-------------|------------------|------------------|----------|-----------------------|-------------|

export function addressToBytes32(address: string | `0x${string}`): string {
  // Validate recipient address
  if (!isAddress(address)) {
    throw new Error("Invalid 0x address");
  }

  return pad(address as `0x${string}`, { size: 32 });
}
