import { VehcilePermissionDescription } from ":core/types/args.js";
import { AccountConfig, KernelConfig, OptionalArgs, _accountConfig, _kernelConfig } from ":core/types/dimo.js";
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
    const defaultPerms: SACD_PERMISSIONS = {};
    args.defaultPermissions = defaultPerms;
  }

  if (args.feeBoostConfig == undefined) {
    const feeBoostConfig = {
      maxFeePerGasPercent: 100,
      maxPriorityFeePerGasPercent: 100,
    };
    args.feeBoostConfig = feeBoostConfig;
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
    defaultPermissions: args.defaultPermissions,
    feeBoostConfig: args.feeBoostConfig,
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

export const unpackOptionalArgs = (optionalArgs?: OptionalArgs): OptionalArgs => {
  if (optionalArgs == undefined) {
    return {
      feeBoostConfig: {
        maxFeePerGasPercent: 0,
        maxPriorityFeePerGasPercent: 0,
      },
    };
  }

  return optionalArgs;
};

export const sacdPermissionValue = (sacdPerms: SACD_PERMISSIONS): bigint => {
  const permissionMap = [
    sacdPerms.APPROXIMATE_LOCATION,
    sacdPerms.RAW_DATA,
    sacdPerms.STREAMS,
    sacdPerms.CREDENTIALS,
    sacdPerms.ALLTIME_LOCATION,
    sacdPerms.CURRENT_LOCATION,
    sacdPerms.COMMANDS,
    sacdPerms.NONLOCATION_TELEMETRY,
  ];

  const permissionString = permissionMap.map((perm) => (perm ? "11" : "00")).join("") + "00";

  return BigInt(`0b${permissionString}`);
};

export const sacdPermissionArray = (permissionValue: BigInt): string[] => {
  const sacdPermArray: string[] = [];

  // Convert the bigint to a binary string
  const binaryString = permissionValue.toString(2).padStart(PERMISSION_CONFIGS.length * 2, "0");

  for (let i = 0; i < PERMISSION_CONFIGS.length; i++) {
    const perm = PERMISSION_CONFIGS[i];
    const permission = binaryString.slice(perm.range[0], perm.range[1]);
    if (permission.includes("1")) {
      sacdPermArray.push(perm.description);
    }
  }

  return sacdPermArray;
};

export const sacdDescription = (args: VehcilePermissionDescription): string => {
  const description = `By proceeding, you will grant data access and control functions to ${args.appName} effective as of ${args.effectiveAt} until ${new Date(Number(args.expiration) * 1000).toISOString()}. Permissions being granted: ${args.permissionArray.join("; ")} Driver ID: ${args.driverID} App ID: ${args.appID} DIMO Platform, version 1.0.`;
  return description;
};

export const PERMISSIONS = {
  NONLOCATION_TELEMETRY: "NONLOCATION_TELEMETRY: non-location vehicle data such as fuel levels and odometer.",
  COMMANDS: "COMMANDS: ability to send commands to the vehicle such as lock and unlock.",
  CURRENT_LOCATION: "CURRENT_LOCATION: access to the vehicle current location.",
  ALLTIME_LOCATION: "ALLTIME_LOCATION: access to the vehicle full location history.",
  CREDENTIALS: "CREDENTIALS: access to any stored credentials and attestations such as insurance and service records.",
  STREAMS: "STREAMS: access to real-time data streams.",
  RAW_DATA: "RAW_DATA: access to raw payload data.",
  APPROXIMATE_LOCATION: "APPROXIMATE_LOCATION: access to approximate vehicle location.",
};

type PermissionConfig = {
  range: [number, number];
  description: string;
};

export type SACD_PERMISSIONS = Partial<Record<keyof typeof PERMISSIONS, boolean>>;

export const PERMISSION_CONFIGS: PermissionConfig[] = Object.keys(PERMISSIONS).map((permission, index) => ({
  range: [-(2 * (index + 1 * 2)), -(2 * index) - 2],
  description: PERMISSIONS[permission as keyof typeof PERMISSIONS],
}));

PERMISSION_CONFIGS.unshift({
  range: [-2, 0],
  description: "",
});

// | APPROX LOCATION | RAW DATA | STREAMS | CREDENTIALS | ALLTIME_LOCATION | CURRENT_LOCATION | COMMANDS | NONLOCATION_TELEMETRY | ZERO-PADDED |
// |-----------------|----------|---------|-------------|------------------|------------------|----------|-----------------------|-------------|
// |      11         |   11     |   11    |     11      |       11         |       11         |    11    |          11           |     00      |  262140n
// |-----------------|----------|---------|-------------|------------------|------------------|----------|-----------------------|-------------|
