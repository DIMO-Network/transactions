import { ContractToMapping, ENVIRONMENT, KernelConfig, _kernelConfig } from ":core/types/dimo.js";
import { Chain, PublicClient, Transport, createPublicClient, createWalletClient, http } from "viem";
import {
  KernelAccountClient,
  KernelSmartAccount,
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { BundlerClient, GetUserOperationReceiptReturnType, createBundlerClient } from "permissionless";
import { mintVehicleWithDeviceDefinition } from ":core/actions/mintVehicleWithDeviceDefinition.js";
import { setVehiclePermissions } from ":core/actions/setPermissionsSACD.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING } from ":core/constants/mappings.js";
import {
  BurnVehicle,
  ClaimAftermarketdevice,
  MintVehicleWithDeviceDefinition,
  PairAftermarketDevice,
  SendDIMOTokens,
  SetVehiclePermissions,
  TransferVehicleAndAftermarketDeviceIDs,
  UnPairAftermarketDevice,
} from ":core/types/args.js";
import { claimAftermarketDevice, claimAftermarketDeviceTypeHash } from ":core/actions/claimAftermarketDevice.js";
import { TypeHashResponse } from ":core/types/responses.js";
import { sendDIMOTokens } from ":core/actions/sendDIMOTokens.js";
import { pairAftermarketDevice } from ":core/actions/pairAftermarketDevice.js";
import { TurnkeyClient } from "@turnkey/http";
import { polygon } from "viem/chains";
import { burnVehicle } from ":core/actions/burnVehicle.js";
import { createAccount } from "@turnkey/viem";
import { walletClientToSmartAccountSigner } from "permissionless/utils";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { privateKeyToAccount } from "viem/accounts";
import { transferVehicleAndAftermarketDeviceIDs } from ":core/actions/transferVehicleAndADs.js";
import { unpairAftermarketDevice } from ":core/actions/unpairAftermarketDevice.js";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { generateP256KeyPair, decryptBundle, getPublicKey } from "@turnkey/crypto";
import { uint8ArrayToHexString, uint8ArrayFromHexString } from "@turnkey/encoding";
import { claimAndPairDevice } from ":core/actions/claimAndPair.js";

export class KernelSigner {
  config: _kernelConfig;
  publicClient: PublicClient;
  bundlerClient: BundlerClient<EntryPoint, Chain | undefined>;
  kernelClient: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>;
  sessionClient:
    | KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>
    | undefined;
  contractMapping: ContractToMapping;
  chain: Chain;
  kernelAddress: `0x${string}` | undefined;
  turnkeyClient: TurnkeyClient | undefined;
  turnkeyPasskeyClient: TurnkeyClient | undefined;
  private _init: boolean = false;
  private _subOrganizationId: string | undefined;
  private _walletAddress: `0x${string}` | undefined;
  private _walletSession: {
    active: boolean;
    expires: number;
  } = {
    active: false,
    expires: 0,
  };
  expire: number = 0;

  constructor(config: KernelConfig) {
    this.config = config as _kernelConfig;
    this.chain =
      ENV_NETWORK_MAPPING.get(ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD) ?? polygon;
    this.contractMapping =
      CHAIN_ABI_MAPPING[ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD].contracts;
    this.publicClient = createPublicClient({
      transport: http(this.config.rpcUrl),
      chain: this.chain,
    });

    this.bundlerClient = createBundlerClient({
      chain: this.chain,
      transport: http(this.config.bundlerUrl),
      entryPoint: this.config.entryPoint,
    });
  }

  public async passkeyInit(subOrganizationId: string, walletAddress: `0x${string}`, stamper: any) {
    if (!this._init) {
      this._init = true;
      this._subOrganizationId = subOrganizationId;
      this._walletAddress = walletAddress;
    }

    this.turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);
    this.turnkeyPasskeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);
    const localAccount = await createAccount({
      // @ts-ignore
      client: this.turnkeyClient,
      organizationId: subOrganizationId,
      signWith: walletAddress,
      ethereumAddress: walletAddress,
    });

    const smartAccountClient = createWalletClient({
      account: localAccount,
      chain: this.chain,
      transport: http(this.config.rpcUrl),
    });

    const smartAccountSigner = walletClientToSmartAccountSigner(smartAccountClient);
    const ecdsaValidator = await signerToEcdsaValidator(this.publicClient, {
      signer: smartAccountSigner,
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    const account = await createKernelAccount(this.publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    this.kernelClient = createKernelAccountClient({
      account,
      chain: this.chain,
      entryPoint: this.config.entryPoint,
      bundlerTransport: http(this.config.bundlerUrl),
      middleware: {
        // @ts-ignore
        sponsorUserOperation: async ({ userOperation }) => {
          const zerodevPaymaster = createZeroDevPaymasterClient({
            chain: this.chain,
            entryPoint: this.config.entryPoint,
            transport: http(this.config.paymasterUrl),
          });
          return zerodevPaymaster.sponsorUserOperation({
            userOperation,
            entryPoint: this.config.entryPoint,
          });
        },
      },
    });

    this.kernelAddress = account.address;
  }

  public async openSessionWithPasskey(): Promise<{
    active: boolean;
    expires: number;
  }> {
    if (!this.config.useWalletSession) {
      return {
        active: false,
        expires: 0,
      };
    }

    if (new Date(this.expire) > new Date(Date.now())) {
      return this._walletSession;
    }

    if (!this.turnkeyClient) {
      throw new Error("Turnkey client not initialized");
    }

    if (!this._subOrganizationId) {
      throw new Error("Sub organization id not set");
    }

    if (!this._walletAddress) {
      throw new Error("Wallet address not set");
    }

    if (!this.turnkeyPasskeyClient) {
      throw new Error("Turnkey passkey client not initialized");
    }

    const timestamp = Date.now();
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 1000;

    const key = generateP256KeyPair();
    const targetPubHex = key.publicKeyUncompressed;
    const sessionData = await this.turnkeyPasskeyClient!.createReadWriteSession({
      organizationId: this._subOrganizationId,
      type: "ACTIVITY_TYPE_CREATE_READ_WRITE_SESSION_V2",
      timestampMs: timestamp.toString(),
      parameters: {
        targetPublicKey: targetPubHex,
        expirationSeconds: this.config.sessionTimeoutSeconds,
      },
    });

    const bundle = sessionData.activity.result.createReadWriteSessionResultV2?.credentialBundle;
    const decryptedBundle = decryptBundle(bundle!, key.privateKey);
    const privateKey = uint8ArrayToHexString(decryptedBundle);

    const apiStamper = new ApiKeyStamper({
      apiPublicKey: uint8ArrayToHexString(getPublicKey(uint8ArrayFromHexString(privateKey), true)),
      apiPrivateKey: privateKey,
    });

    const turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, apiStamper);
    const localAccount = await createAccount({
      // @ts-ignore
      client: turnkeyClient,
      organizationId: this._subOrganizationId,
      signWith: this._walletAddress,
      ethereumAddress: this._walletAddress,
    });

    const smartAccountClient = createWalletClient({
      account: localAccount,
      chain: this.chain,
      transport: http(this.config.rpcUrl),
    });

    const smartAccountSigner = walletClientToSmartAccountSigner(smartAccountClient);
    const ecdsaValidator = await signerToEcdsaValidator(this.publicClient, {
      signer: smartAccountSigner,
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    const account = await createKernelAccount(this.publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    this.sessionClient = createKernelAccountClient({
      account,
      chain: this.chain,
      entryPoint: this.config.entryPoint,
      bundlerTransport: http(this.config.bundlerUrl),
      middleware: {
        // @ts-ignore
        sponsorUserOperation: async ({ userOperation }) => {
          const zerodevPaymaster = createZeroDevPaymasterClient({
            chain: this.chain,
            entryPoint: this.config.entryPoint,
            transport: http(this.config.paymasterUrl),
          });
          return zerodevPaymaster.sponsorUserOperation({
            userOperation,
            entryPoint: this.config.entryPoint,
          });
        },
      },
    });
    this._walletSession = {
      active: true,
      expires: expiration,
    };
    this.expire = expiration;

    return this._walletSession;
  }

  public walletSessionActive() {
    return new Date(this.expire) < new Date(Date.now());
  }

  public sessionInfos() {
    return this._walletSession;
  }

  public async privateKeyInit(privateKey: `0x${string}`) {
    const ecdsaValidator = await signerToEcdsaValidator(this.publicClient, {
      signer: privateKeyToAccount(privateKey),
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    const account = await createKernelAccount(this.publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint: this.config.entryPoint,
      // @ts-ignore
      kernelVersion: this.config.kernelVersion,
    });

    this.kernelClient = createKernelAccountClient({
      account,
      chain: this.chain,
      entryPoint: this.config.entryPoint,
      bundlerTransport: http(this.config.bundlerUrl),
      middleware: {
        // @ts-ignore
        sponsorUserOperation: async ({ userOperation }) => {
          const zerodevPaymaster = createZeroDevPaymasterClient({
            chain: this.chain,
            entryPoint: this.config.entryPoint,
            transport: http(this.config.paymasterUrl),
          });
          return zerodevPaymaster.sponsorUserOperation({
            userOperation,
            entryPoint: this.config.entryPoint,
          });
        },
      },
    });

    this.kernelAddress = account.address;
  }

  public async mintVehicleWithDeviceDefinition(
    args: MintVehicleWithDeviceDefinition
  ): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const mintVehicleCallData = await mintVehicleWithDeviceDefinition(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: mintVehicleCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async setVehiclePermissions(args: SetVehiclePermissions): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const setVehiclePermissionsCallData = await setVehiclePermissions(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: setVehiclePermissionsCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async sendDIMOTokens(args: SendDIMOTokens): Promise<GetUserOperationReceiptReturnType> {
    const setVehiclePermissionsCallData = await sendDIMOTokens(args, this.kernelClient, this.config.environment);
    const userOpHash = await this.kernelClient.sendUserOperation({
      userOperation: {
        callData: setVehiclePermissionsCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public claimAftermarketDeviceTypeHash(aftermarketDeviceNode: bigint, owner: `0x${string}`): TypeHashResponse {
    return claimAftermarketDeviceTypeHash(aftermarketDeviceNode, owner, this.config.environment);
  }

  public async claimAftermarketDevice(args: ClaimAftermarketdevice): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const claimADCallData = await claimAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: claimADCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async pairAftermarketDevice(args: PairAftermarketDevice): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const pairADCallData = await pairAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: pairADCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async claimAndPairAftermarketDevice(
    args: ClaimAftermarketdevice & PairAftermarketDevice
  ): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const claimAndPairCallData = await claimAndPairDevice(args, client, this.config.environment);
    const claimAndPairADHash = await client.sendUserOperation({
      userOperation: {
        callData: claimAndPairCallData as `0x${string}`,
      },
    });

    const result = await this.bundlerClient.waitForUserOperationReceipt({ hash: claimAndPairADHash });
    return result;
  }

  public async burnVehicle(args: BurnVehicle): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const burnVehicleCallData = await burnVehicle(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: burnVehicleCallData as `0x${string}`,
      },
    });

    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async transferVehicleAndAftermarketDevices(
    args: TransferVehicleAndAftermarketDeviceIDs
  ): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const burnVehicleCallData = await transferVehicleAndAftermarketDeviceIDs(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: burnVehicleCallData as `0x${string}`,
      },
    });

    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async unpairAftermarketDevice(args: UnPairAftermarketDevice): Promise<GetUserOperationReceiptReturnType> {
    let client = this.kernelClient;
    if (this.config.useWalletSession) {
      await this.openSessionWithPasskey();

      if (this.sessionClient) {
        client = this.sessionClient!;
      }
    }

    const unpairADCallData = await unpairAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: unpairADCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }
}
