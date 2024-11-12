import { SACD_PERMISSIONS, VehcilePermissionDescription } from ":core/types/args.js";
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

  if (args.usePrivateKey == undefined) {
    args.usePrivateKey = false;
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
    usePrivateKey: args.usePrivateKey,
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

export const sacdPermissionArray = (permissionValue: bigint): string[] => {
  const sacdPermArray: string[] = [];

  // Convert the bigint to a binary string
  const binaryString = permissionValue.toString(2).padStart(14, "0");

  // Extract each field by slicing the binary string from right to left
  // Skip zero bits, not used in permissions object: binaryString.slice(-2);
  const alltimeNonlocation = binaryString.slice(-4, -2);
  const commands = binaryString.slice(-6, -4);
  const currentLocation = binaryString.slice(-8, -6);
  const alltimeLocation = binaryString.slice(-10, -8);
  const verifiableCredentials = binaryString.slice(-12, -10);
  const streams = binaryString.slice(-14, -12);

  // Map binary values to boolean fields in the permissions object
  if (alltimeLocation.includes("1")) {
    sacdPermArray.push("ALLTIME_LOCATION: access to the vehicle’s full location history.");
  }

  if (alltimeNonlocation.includes("1")) {
    sacdPermArray.push("NONLOCATION_TELEMETRY: non-location vehicle data such as fuel levels and odometer.");
  }

  if (commands.includes("1")) {
    sacdPermArray.push("COMMANDS: ability to send commands to the vehicle such as lock and unlock.");
  }

  if (currentLocation.includes("1")) {
    sacdPermArray.push("CURRENT_LOCATION: access to the vehicle’s current location.");
  }

  if (verifiableCredentials.includes("1")) {
    sacdPermArray.push(
      "CREDENTIALS: access to any stored credentials and attestations such as insurance and service records."
    );
  }

  if (streams.includes("1")) {
    sacdPermArray.push("STREAMS: Access to real-time data streams.");
  }

  return sacdPermArray;
};

export const sacdDescription = (args: VehcilePermissionDescription): string => {
  const description = `By proceeding, you will grant data access and control functions to ${args.appName} effective as of ${Date.now()} until ${new Date(Number(args.expiration))}. \nPermissions being granted: \n${args.permissionArray.join("; ")}\nDriver ID: ${args.driverID} \nApp ID: ${args.appID}\nDIMO Platform, version 1.0.`;
  return description;
};
