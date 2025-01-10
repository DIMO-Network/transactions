import { KERNEL_V3_1 } from "@zerodev/sdk/constants";
import {
  SACD_PERMISSIONS,
  newKernelConfig,
  sacdPermissionValue,
  sacdPermissionArray,
  PERMISSION_CONFIGS,
} from "../dist/index.js";
import { expect } from "chai";

describe("Kernel Signer Config", () => {
  it("should assign correct default values when fields are left undefined.", () => {
    const kernelConfig = newKernelConfig({
      rpcUrl: "rpcUrl",
      bundlerUrl: "bundlerUrl",
      paymasterUrl: "paymasterUrl",
      clientId: "clientId",
      domain: "domain",
      redirectUri: "redirectUri",
    });

    expect(kernelConfig).to.be.an("object");
    expect(kernelConfig.entryPoint.version).to.equal("0.7");
    expect(kernelConfig.entryPoint.address).to.equal("0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    expect(kernelConfig.kernelVersion).to.equal(KERNEL_V3_1);
    expect(kernelConfig.environment).to.equal("prod");
    expect(kernelConfig.useWalletSession).to.be.false;
    expect(kernelConfig.sessionTimeoutSeconds).to.equal("900");
    expect(kernelConfig.usePrivateKey).to.be.false;
    expect(kernelConfig.defaultPermissions).to.deep.equal({});
  });
});

describe("Permissions value", () => {
  function setDefaultPermissionsValue(values: SACD_PERMISSIONS) {
    return newKernelConfig({
      rpcUrl: "rpcUrl",
      bundlerUrl: "bundlerUrl",
      paymasterUrl: "paymasterUrl",
      clientId: "clientId",
      domain: "domain",
      redirectUri: "redirectUri",
      defaultPermissions: values,
    });
  }

  it("should return the correct permission value when no perms are set", () => {
    const config = setDefaultPermissionsValue({});
    const permissionValue = sacdPermissionValue(config.defaultPermissions);
    expect(Number(permissionValue)).to.be.equal(0);
  });

  it("should return the correct permission value when all perms are set", () => {
    const config = setDefaultPermissionsValue({
      NONLOCATION_TELEMETRY: true,
      COMMANDS: true,
      CURRENT_LOCATION: true,
      ALLTIME_LOCATION: true,
      CREDENTIALS: true,
      STREAMS: true,
      RAW_DATA: true,
      APPROXIMATE_LOCATION: true,
    });
    const permissionValue = sacdPermissionValue(config.defaultPermissions);
    expect(Number(permissionValue)).to.be.equal(262140);
  });

  it("should return the complete permission array when all values are set", () => {
    const config = setDefaultPermissionsValue({
      NONLOCATION_TELEMETRY: true,
      COMMANDS: true,
      CURRENT_LOCATION: true,
      ALLTIME_LOCATION: true,
      CREDENTIALS: true,
      STREAMS: true,
      RAW_DATA: true,
      APPROXIMATE_LOCATION: true,
    });
    const permissionValue = sacdPermissionValue(config.defaultPermissions);
    const permissionArray = sacdPermissionArray(permissionValue);
    // subtracting 1 from config length to account for zeropadding
    expect(permissionArray.length).to.be.equal(PERMISSION_CONFIGS.length - 1);
  });
});
