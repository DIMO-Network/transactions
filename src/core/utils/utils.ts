import { SACD_PERMISSIONS } from ":core/types/args.js";
import { AccountConfig, KernelConfig, _accountConfig, _kernelConfig } from ":core/types/dimo.js";
import { KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { entryPoint07Address } from "viem/account-abstraction";

export const newKernelConfig = (args: KernelConfig): _kernelConfig => {
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
    args.entryPoint = entryPoint07Address;
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

  return {
    rpcUrl: args.rpcUrl,
    bundlerUrl: args.bundlerUrl,
    paymasterUrl: args.paymasterUrl,
    turnkeyApiBaseUrl: args.turnkeyApiBaseUrl,
    entryPoint: args.entryPoint,
    kernelVersion: args.kernelVersion,
    environment: args.environment,
    useWalletSession: args.useWalletSession,
    sessionTimeoutSeconds: args.sessionTimeoutSeconds,
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

export const sacdPermissionValue = (sacdPerms: SACD_PERMISSIONS): bigint => {
  // nothing in right most position
  let skipZero = "00";
  let alltimeNonlocation = "00";
  let commands = "00";
  let currentLocation = "00";
  let alltimeLocation = "00";
  let verifiableCredentials = "00";
  let streams = "00";

  if (sacdPerms.ALLTIME_NONLOCATION) {
    alltimeNonlocation = "11";
  }

  if (sacdPerms.COMMANDS) {
    commands = "11";
  }

  if (sacdPerms.CURRENT_LOCATION) {
    currentLocation = "11";
  }

  if (sacdPerms.ALLTIME_LOCATION) {
    alltimeLocation = "11";
  }

  if (sacdPerms.VERIFIABLE_CREDENTIALS) {
    verifiableCredentials = "11";
  }

  if (sacdPerms.STREAMS) {
    streams = "11";
  }

  const permissionString =
    streams + verifiableCredentials + alltimeLocation + currentLocation + commands + alltimeNonlocation + skipZero;

  return BigInt(`0b${permissionString}`);
};
