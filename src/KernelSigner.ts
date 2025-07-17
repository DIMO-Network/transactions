import {
  ContractToMapping,
  DIMO_APIs,
  ENVIRONMENT,
  KernelConfig,
  TransactionReturnType,
  _kernelConfig,
  SACDTemplate,
} from ":core/types/dimo.js";
import { Chain, Client, PublicClient, RpcSchema, Transport, createPublicClient, http } from "viem";
import {
  KernelAccountClient,
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getUserOperationGasPrice,
} from "@zerodev/sdk";
import type { BundlerClient, SmartAccount } from "viem/account-abstraction";
import {
  mintVehicleWithDeviceDefinition,
  mintVehicleWithDeviceDefinitionBatch,
} from ":core/actions/mintVehicleWithDeviceDefinition.js";
import {
  generatePermissionsSACDTemplate,
  setVehiclePermissions,
  setVehiclePermissionsBatch,
  setVehiclePermissionsBulk,
} from ":core/actions/setPermissionsSACD.js";
import { CHAIN_ABI_MAPPING, ENV_MAPPING, ENV_NETWORK_MAPPING, ENV_TO_API_MAPPING } from ":core/constants/mappings.js";
import {
  AddStake,
  AttachVehicle,
  BurnSyntheticDevice,
  BurnVehicle,
  ClaimAftermarketDevice,
  DeriveKernelAddress,
  DetachVehicle,
  MintVehicleWithDeviceDefinition,
  PairAftermarketDevice,
  PermissionsSACDTemplateInputs,
  SendDIMOTokens,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
  TransactionInput,
  TransferVehicleAndAftermarketDeviceIDs,
  UnPairAftermarketDevice,
  UpgradeStake,
  WithdrawStake,
  Permission,
} from ":core/types/args.js";
import type { BridgeInitiateArgs } from ":core/types/wormhole.js";
import { claimAftermarketDevice, claimAftermarketDeviceTypeHash } from ":core/actions/claimAftermarketDevice.js";
import { TypeHashResponse } from ":core/types/responses.js";
import { sendDIMOTokens } from ":core/actions/sendDIMOTokens.js";
import { pairAftermarketDevice } from ":core/actions/pairAftermarketDevice.js";
import { TurnkeyClient } from "@turnkey/http";
import { polygon } from "viem/chains";
import { burnVehicle, burnVehicleBatch } from ":core/actions/burnVehicle.js";
import { burnSyntheticDevice, burnSyntheticDeviceBatch } from ":core/actions/burnSyntheticDevice.js";
import { createAccount } from "@turnkey/viem";
import { getKernelAddressFromECDSA, signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { privateKeyToAccount } from "viem/accounts";
import { transferVehicleAndAftermarketDeviceIDs } from ":core/actions/transferVehicleAndADs.js";
import { unpairAftermarketDevice } from ":core/actions/unpairAftermarketDevice.js";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { generateP256KeyPair, decryptBundle, getPublicKey } from "@turnkey/crypto";
import { uint8ArrayToHexString, uint8ArrayFromHexString } from "@turnkey/encoding";
import { claimAndPairDevice } from ":core/actions/claimAndPair.js";
import { executeTransaction, executeTransactionBatch } from ":core/actions/executeTransaction.js";
import { createBundlerClient } from "viem/account-abstraction";
import { getPermissionsValue, getPermissionsArray } from ":core/utils/utils.js";
import { addStake } from ":core/actions/addStake.js";
import { withdrawStake } from ":core/actions/withdrawStake.js";
import { upgradeStake } from ":core/actions/upgradeStake.js";
import { attachVehicle } from ":core/actions/attachVehicle.js";
import { detachVehicle } from ":core/actions/detachVehicle.js";
import { initiateBridging } from ":core/actions/wormholeBridge.js";

export class KernelSigner {
  config: _kernelConfig;
  publicClient: PublicClient;
  bundlerClient: BundlerClient;
  contractMapping: ContractToMapping;
  chain: Chain;
  kernelAddress?: `0x${string}`;
  subOrganizationId?: string;
  walletAddress?: `0x${string}`;
  smartContractAddress?: `0x${string}`;
  authBaseUrl: string;
  ifpsUrl: string;
  activeClient = false;

  apiSessionClient = {
    client: undefined as KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema> | undefined,
    expires: 0,
    initialized: false,
  };

  passkeyClient = {
    turnkeyClient: undefined as TurnkeyClient | undefined,
    valid: false,
    client: undefined as KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema> | undefined,
    initialized: false,
  };

  passkeySessionClient = {
    client: undefined as KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema> | undefined,
    expires: 0,
    initialized: false,
  };

  privateKeyClient = {
    valid: false,
    client: undefined as KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema> | undefined,
    initialized: false,
  };

  constructor(config: KernelConfig) {
    this.config = config as _kernelConfig;
    const env = ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD;
    this.chain = ENV_NETWORK_MAPPING.get(env) ?? polygon;

    const apiMapping = ENV_TO_API_MAPPING[env];

    this.contractMapping = CHAIN_ABI_MAPPING[env].contracts;
    this.authBaseUrl = apiMapping[DIMO_APIs.AUTH].url;
    this.ifpsUrl = apiMapping[DIMO_APIs.IPFS].url;

    this.publicClient = createPublicClient({
      transport: http(this.config.rpcUrl),
      chain: this.chain,
    });

    this.bundlerClient = createBundlerClient({
      chain: this.chain,
      transport: http(this.config.bundlerUrl),
    });
  }

  // HELPERS

  public resetClient(): boolean {
    const defaultClientState = {
      client: undefined,
      expires: 0,
      initialized: false,
    };

    this.activeClient = false;
    this.kernelAddress = undefined;
    this.subOrganizationId = undefined;
    this.walletAddress = undefined;
    this.smartContractAddress = undefined;

    this.apiSessionClient = { ...defaultClientState };
    this.passkeyClient = {
      turnkeyClient: undefined,
      valid: false,
      ...defaultClientState,
    };
    this.passkeySessionClient = { ...defaultClientState };
    this.privateKeyClient = { valid: false, ...defaultClientState };
    return true;
  }

  private isSessionActive(session: { expires: number }): boolean {
    return session.expires > Date.now();
  }

  public hasActiveSession(): boolean {
    if (this.config.usePrivateKey) return true;

    const now = Date.now();
    if (this.apiSessionClient.expires > now) return true;

    if (this.config.useWalletSession) {
      if (this.passkeySessionClient.expires > now || this.passkeyClient.valid) {
        return true;
      }
    }

    return false;
  }

  public async getActiveClient(): Promise<KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema>> {
    if (this.config.usePrivateKey && this.privateKeyClient.client) {
      return this.privateKeyClient.client;
    }

    const now = Date.now();

    if (this.apiSessionClient.expires > now && this.apiSessionClient.client) {
      return this.apiSessionClient.client;
    }

    if (this.config.useWalletSession) {
      if (this.passkeySessionClient.expires > now && this.passkeySessionClient.client) {
        return this.passkeySessionClient.client;
      }

      try {
        await this.openSessionWithPasskey();
        if (this.passkeySessionClient.expires > now && this.passkeySessionClient.client) {
          return this.passkeySessionClient.client;
        }
      } catch {
        if (this.passkeyClient.valid && this.passkeyClient.client) {
          return this.passkeyClient.client;
        }
      }
    }

    throw new Error("No active client");
  }

  public async getPasskeyClient(): Promise<KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema>> {
    if (this.passkeyClient.valid && this.passkeyClient.client) {
      return this.passkeyClient.client;
    }

    throw new Error("Passkey client not initialized");
  }

  public getDefaultPermissionValue(): bigint {
    return getPermissionsValue(this.config.defaultPermissions) as bigint;
  }

  public getDefaultPermissionArray(): Permission[] {
    const val: bigint = getPermissionsValue(this.config.defaultPermissions) as bigint;
    return getPermissionsArray(val);
  }

  // INITIALIZING SDK

  public async init(subOrganizationId: string, stamper: any): Promise<void> {
    if (this.isSessionActive(this.passkeySessionClient)) return;

    const timestamp = Date.now();
    const key = generateP256KeyPair();
    const targetPubHex = key.publicKeyUncompressed;
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 0.75 * 1000;

    this.subOrganizationId = subOrganizationId;
    this.passkeyClient.turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);
    this.passkeyClient.valid = true;
    this.passkeyClient.initialized = true;

    const sessionData = await this.passkeyClient.turnkeyClient!.createReadWriteSession({
      organizationId: this.subOrganizationId,
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
    this.passkeySessionClient.expires = expiration;
    this.passkeySessionClient.initialized = true;
    const wallets = await turnkeyClient.getWallets({
      organizationId: subOrganizationId,
    });
    const walletAddr = await turnkeyClient.getWalletAccounts({
      organizationId: subOrganizationId,
      walletId: wallets.wallets[0].walletId,
    });

    this.walletAddress = walletAddr.accounts[0].address as `0x${string}`;
    this.passkeySessionClient.client = await this._createKernelAccount(
      turnkeyClient,
      subOrganizationId,
      this.walletAddress!
    );

    this.passkeyClient.client = await this._createKernelAccount(
      this.passkeyClient.turnkeyClient,
      subOrganizationId,
      this.walletAddress!
    );
    this.activeClient = true;

    return;
  }

  public async passkeyInit(subOrganizationId: string, walletAddress: `0x${string}`, stamper: any): Promise<void> {
    this.subOrganizationId = subOrganizationId;
    this.walletAddress = walletAddress;
    const turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);

    this.passkeyClient = {
      turnkeyClient,
      client: await this._createKernelAccount(turnkeyClient, subOrganizationId, walletAddress),
      valid: true,
      initialized: true,
    };

    this.activeClient = true;
  }

  public async passkeyToSession(subOrganizationId: string, stamper: any) {
    if (this.isSessionActive(this.passkeySessionClient)) return;

    const timestamp = Date.now();
    const key = generateP256KeyPair();
    const targetPubHex = key.publicKeyUncompressed;
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 0.75 * 1000;

    this.subOrganizationId = subOrganizationId;
    this.passkeyClient.turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);
    this.passkeyClient.valid = true;
    this.passkeyClient.initialized = true;

    const sessionData = await this.passkeyClient.turnkeyClient!.createReadWriteSession({
      organizationId: this.subOrganizationId,
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
    this.passkeySessionClient.expires = expiration;
    this.passkeySessionClient.initialized = true;
    const wallets = await turnkeyClient.getWallets({
      organizationId: subOrganizationId,
    });
    const walletAddr = await turnkeyClient.getWalletAccounts({
      organizationId: subOrganizationId,
      walletId: wallets.wallets[0].walletId,
    });

    this.walletAddress = walletAddr.accounts[0].address as `0x${string}`;
    this.passkeySessionClient.client = await this._createKernelAccount(
      turnkeyClient,
      subOrganizationId,
      this.walletAddress!
    );

    this.passkeyClient.client = await this._createKernelAccount(
      this.passkeyClient.turnkeyClient,
      subOrganizationId,
      this.walletAddress!
    );
    this.activeClient = true;
    return;
  }

  public async openSessionWithPasskey() {
    if (!this.config.useWalletSession) {
      throw new Error("Wallet session not enabled");
    }
    if (!this.passkeyClient.valid) {
      throw new Error("Passkey client not initialized");
    }
    if (!this.subOrganizationId) {
      throw new Error("Sub organization id not set");
    }

    const timestamp = Date.now();
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 0.75 * 1000;
    const key = generateP256KeyPair();
    const targetPubHex = key.publicKeyUncompressed;
    const sessionData = await this.passkeyClient.turnkeyClient!.createReadWriteSession({
      organizationId: this.subOrganizationId,
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
    const wallets = await turnkeyClient.getWallets({
      organizationId: this.subOrganizationId!,
    });
    const walletAddr = await turnkeyClient.getWalletAccounts({
      organizationId: this.subOrganizationId!,
      walletId: wallets.wallets[0].walletId,
    });

    this.walletAddress = walletAddr.accounts[0].address as `0x${string}`;
    this.passkeySessionClient.client = await this._createKernelAccount(
      turnkeyClient,
      this.subOrganizationId!,
      this.walletAddress!
    );
    this.passkeySessionClient.expires = expiration;
    this.activeClient = true;
    return;
  }

  public async openSessionWithApiStamper(subOrganizationId: string, apiStamper: any) {
    const timestamp = Date.now();
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 0.75 * 1000;

    const turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, apiStamper);

    const wallets = await turnkeyClient.getWallets({
      organizationId: subOrganizationId,
    });
    const walletAddr = await turnkeyClient.getWalletAccounts({
      organizationId: subOrganizationId,
      walletId: wallets.wallets[0].walletId,
    });

    this.walletAddress = walletAddr.accounts[0].address as `0x${string}`;
    this.subOrganizationId = subOrganizationId;

    this.apiSessionClient.client = await this._createKernelAccount(
      turnkeyClient,
      subOrganizationId,
      this.walletAddress!
    );
    this.apiSessionClient.expires = expiration;
    this.apiSessionClient.initialized = true;
    this.activeClient = true;
    return;
  }

  async _createKernelAccount(
    turnkeyClient: TurnkeyClient,
    subOrganizationId: string,
    walletAddress: `0x${string}`
  ): Promise<KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema>> {
    const localAccount = await createAccount({
      // @ts-ignore
      client: turnkeyClient,
      organizationId: subOrganizationId,
      signWith: walletAddress,
      ethereumAddress: walletAddress,
    });

    const ecdsaValidator = await signerToEcdsaValidator(this.publicClient, {
      signer: localAccount,
      entryPoint: this.config.entryPoint,
      kernelVersion: this.config.kernelVersion,
    });

    const account = await createKernelAccount(this.publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint: this.config.entryPoint,
      kernelVersion: this.config.kernelVersion,
    });

    this.kernelAddress = account.address;
    this.smartContractAddress = account.address;
    this.walletAddress = walletAddress;
    const chain = this.chain;
    const paymasterUrl = this.config.paymasterUrl;
    return createKernelAccountClient({
      account: account,
      chain: this.chain,
      bundlerTransport: http(this.config.bundlerUrl),
      client: this.publicClient,
      paymaster: {
        getPaymasterData(userOperation) {
          const paymasterClient = createZeroDevPaymasterClient({
            chain: chain,
            transport: http(paymasterUrl),
          });
          return paymasterClient.sponsorUserOperation({ userOperation });
        },
      },
      userOperation: {
        estimateFeesPerGas: async ({ bundlerClient }) => {
          const gasPrices = await getUserOperationGasPrice(bundlerClient);
          const maxFeeIncrease =
            gasPrices.maxFeePerGas * (BigInt(this.config.feeBoostConfig.maxFeePerGasPercent) / BigInt(100));
          const maxPriorityFeeIncrease =
            gasPrices.maxFeePerGas * (BigInt(this.config.feeBoostConfig.maxPriorityFeePerGasPercent) / BigInt(100));

          return {
            maxFeePerGas: maxFeeIncrease + gasPrices.maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeeIncrease + gasPrices.maxPriorityFeePerGas,
          };
        },
      },
    });
  }

  public async privateKeyInit(privateKey: `0x${string}`) {
    const ecdsaValidator = await signerToEcdsaValidator(this.publicClient, {
      signer: privateKeyToAccount(privateKey),
      entryPoint: this.config.entryPoint,
      kernelVersion: this.config.kernelVersion,
    });

    const account = await createKernelAccount(this.publicClient, {
      plugins: {
        sudo: ecdsaValidator,
      },
      entryPoint: this.config.entryPoint,
      kernelVersion: this.config.kernelVersion,
    });

    this.privateKeyClient.valid = true;

    const chain = this.chain;
    const paymasterUrl = this.config.paymasterUrl;
    this.privateKeyClient.client = createKernelAccountClient({
      account,
      chain: this.chain,
      bundlerTransport: http(this.config.bundlerUrl),
      paymaster: {
        getPaymasterData(userOperation) {
          const paymasterClient = createZeroDevPaymasterClient({
            chain: chain,
            transport: http(paymasterUrl),
          });
          return paymasterClient.sponsorUserOperation({ userOperation });
        },
      },
    });

    this.kernelAddress = account.address;
    this.activeClient = true;
  }

  public async mintVehicleWithDeviceDefinition(
    args: MintVehicleWithDeviceDefinition | MintVehicleWithDeviceDefinition[],
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    let mintVehicleCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      mintVehicleCallData = await mintVehicleWithDeviceDefinition(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch minting limit: 25");
      }
      mintVehicleCallData = await mintVehicleWithDeviceDefinitionBatch(args, client, this.config.environment);
    }

    const userOpHash = await this._sendUserOperation(client, mintVehicleCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async setVehiclePermissions(
    args: SetVehiclePermissions | SetVehiclePermissions[],
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    let setVehiclePermissionsCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      setVehiclePermissionsCallData = await setVehiclePermissions(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch vehicle permission limit: 25");
      }
      setVehiclePermissionsCallData = await setVehiclePermissionsBatch(args, client, this.config.environment);
    }

    const userOpHash = await this._sendUserOperation(client, setVehiclePermissionsCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async setVehiclePermissionsBulk(
    args: SetVehiclePermissionsBulk,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const setVehiclePermissionsBulkCallData = await setVehiclePermissionsBulk(args, client, this.config.environment);

    const userOpHash = await this._sendUserOperation(client, setVehiclePermissionsBulkCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async sendDIMOTokens(
    args: SendDIMOTokens,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getPasskeyClient();

    const sendDIMOTokensCallData = await sendDIMOTokens(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, sendDIMOTokensCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public claimAftermarketDeviceTypeHash(aftermarketDeviceNode: bigint, owner: `0x${string}`): TypeHashResponse {
    return claimAftermarketDeviceTypeHash(aftermarketDeviceNode, owner, this.config.environment);
  }

  public async claimAftermarketDevice(
    args: ClaimAftermarketDevice,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    const claimADCallData = await claimAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, claimADCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async pairAftermarketDevice(
    args: PairAftermarketDevice,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    const pairADCallData = await pairAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, pairADCallData);
    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async claimAndPairAftermarketDevice(
    args: ClaimAftermarketDevice & PairAftermarketDevice,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    const claimAndPairCallData = await claimAndPairDevice(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, claimAndPairCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async burnVehicle(
    args: BurnVehicle | BurnVehicle[],
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    let burnVehicleCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      burnVehicleCallData = await burnVehicle(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch vehicle burn limit: 25");
      }
      burnVehicleCallData = await burnVehicleBatch(args, client, this.config.environment);
    }

    const userOpHash = await this._sendUserOperation(client, burnVehicleCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async burnSyntheticDevice(
    args: BurnSyntheticDevice | BurnSyntheticDevice[],
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    let burnSyntheticDeviceCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      burnSyntheticDeviceCallData = await burnSyntheticDevice(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch vehicle burn limit: 25");
      }
      burnSyntheticDeviceCallData = await burnSyntheticDeviceBatch(args, client, this.config.environment);
    }

    const userOpHash = await this._sendUserOperation(client, burnSyntheticDeviceCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async transferVehicleAndAftermarketDevices(
    args: TransferVehicleAndAftermarketDeviceIDs,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();

    const callData = await transferVehicleAndAftermarketDeviceIDs(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, callData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async unpairAftermarketDevice(
    args: UnPairAftermarketDevice,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const unpairADCallData = await unpairAftermarketDevice(args, client, this.config.environment);

    const userOpHash = await this._sendUserOperation(client, unpairADCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async addStake(
    args: AddStake,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const addStakeCallData = await addStake(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, addStakeCallData);
    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async withdrawStake(
    args: WithdrawStake,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const addStakeCallData = await withdrawStake(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, addStakeCallData);
    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async upgradeStake(
    args: UpgradeStake,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const upgradeStakeCallData = await upgradeStake(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, upgradeStakeCallData);

    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async attacheVehicleToStake(
    args: AttachVehicle,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const upgradeStakeCallData = await attachVehicle(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, upgradeStakeCallData);

    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async detachVehicleFromStake(
    args: DetachVehicle,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const upgradeStakeCallData = await detachVehicle(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, upgradeStakeCallData);

    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async initiateBridging(
    args: BridgeInitiateArgs,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const initiateBridgingCallData = await initiateBridging(args, client, this.config.environment);
    const userOpHash = await this._sendUserOperation(client, initiateBridgingCallData);

    if (waitForReceipt) {
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  public async signTypedData(arg: any): Promise<any> {
    const client = await this.getActiveClient();
    return client.signTypedData(arg);
  }

  public async signChallenge(challenge: string): Promise<`0x${string}`> {
    const client = await this.getActiveClient();
    return client.signMessage({
      message: challenge,
    });
  }

  public async generateChallenge(
    clientId: string,
    domain: string,
    address: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      const queryParams = new URLSearchParams({
        client_id: clientId,
        domain: domain,
        scope: "openid email",
        response_type: "code",
        address: address,
      }).toString();

      const response = await fetch(`${this.authBaseUrl}/auth/web3/generate_challenge`, {
        method: "POST",
        body: queryParams,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.message || "Failed to generate challenge",
        };
      }

      const data = await response.json();
      return { success: true, data: data };
    } catch (error) {
      console.error("Error generating challenge:", error);
      return {
        success: false,
        error: "An error occurred while generating challenge",
      };
    }
  }

  public async submitWeb3Challenge(
    clientId: string,
    state: string,
    domain: string,
    signature: string
  ): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      // Construct the body using URLSearchParams for form-urlencoded
      const formBody = new URLSearchParams({
        client_id: clientId,
        state: state,
        grant_type: "authorization_code", // Fixed value
        domain: domain,
        signature: signature, // The 0x-prefixed signature obtained from Step 2
      }).toString();

      const response = await fetch(`${this.authBaseUrl}/auth/web3/submit_challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: formBody, // Send the form-encoded body
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          error: errorData.message || "Failed to submit challenge",
        };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error("Error submitting web3 challenge:", error);
      return {
        success: false,
        error: "An error occurred while submitting challenge",
      };
    }
  }

  public async getJWT(address?: string): Promise<{ success: boolean; error?: string; data?: any }> {
    if (!address) {
      const client = await this.getActiveClient();
      address = client.account!.address as string;
    }

    const challengeResponse = await this.generateChallenge(this.config.clientId, this.config.domain, address!);
    const challenge = challengeResponse.data.challenge;
    const state = challengeResponse.data.state;

    const signature = await this.signChallenge(challenge);
    return await this.submitWeb3Challenge(this.config.clientId, state, this.config.redirectUri, signature);
  }

  public async uploadSACDAgreement(signedAgreement: string): Promise<{ success: boolean; error?: string; data?: any }> {
    try {
      const response = await fetch(this.ifpsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signedAgreement),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Error posting data:", error);
      throw error;
    }
  }

  public async signSACDPermissionTemplate(args: PermissionsSACDTemplateInputs): Promise<SACDTemplate> {
    const template = await generatePermissionsSACDTemplate(args);
    const templateStr = JSON.stringify(template);
    const signature = await this.signChallenge(templateStr);
   template.signature = signature;
    return template;
  }

  public async signAndUploadSACDAgreement(args: PermissionsSACDTemplateInputs): Promise<{ success: boolean; cid: string }> {
    const signedSACD = await this.signSACDPermissionTemplate(args);

    try {
      const response = await fetch(this.ifpsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signedSACD),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("Error posting data:", error);
      throw error;
    }
  }

  public async getUserOperationReceipt(userOperationHash: `0x${string}`): Promise<TransactionReturnType> {
    const client = await this.getActiveClient();
    const txResult = await client.waitForUserOperationReceipt({
      hash: userOperationHash,
    });
    return txResult;
  }

  public async isDeployed(args: DeriveKernelAddress): Promise<boolean> {
    switch (true) {
      case args.accountAddress != undefined:
        break;
      case this.kernelAddress != undefined:
        args.accountAddress = this.kernelAddress;
        break;
      case args.walletAddress != undefined:
        args.accountAddress = await this.deriveKernelAddress(args.walletAddress!);
        break;
      default:
        throw new Error("No account address provided");
    }

    const contractCode = await this.publicClient.getCode({
      address: args.accountAddress!,
    });

    if (contractCode) {
      return contractCode !== "0x";
    }

    return false;
  }

  public async deriveKernelAddress(walletAddress: `0x${string}`, number: number = 0): Promise<`0x${string}`> {
    const kernelAddress = await getKernelAddressFromECDSA({
      entryPoint: this.config.entryPoint,
      kernelVersion: this.config.kernelVersion,
      eoaAddress: walletAddress,
      index: BigInt(number),
      publicClient: this.publicClient,
    });

    return kernelAddress;
  }

  public async executeTransaction(
    args: TransactionInput,
    waitForReceipt: boolean = true,
  ): Promise<TransactionReturnType> {
    let client = await this.getActiveClient();
    if (args.requireSignature) {
      client = await this.getPasskeyClient();
    }

    let transactionCallData: `0x${string}`;
    if (!Array.isArray(args.data)) {
      transactionCallData = await executeTransaction(args.data, client);
    } else {
      if (args.data.length >= 25) {
        throw Error("Batch transaction limit: 25");
      }
      transactionCallData = await executeTransactionBatch(args.data, client);
    }

    const userOpHash = await this._sendUserOperation(client, transactionCallData);

    if (waitForReceipt) {
      const client = await this.getActiveClient();
      return await client.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
      });
    }

    return {
      userOperationHash: userOpHash,
      status: "pending",
    } as TransactionReturnType;
  }

  async _sendUserOperation(
    client: KernelAccountClient<Transport, Chain, SmartAccount, Client, RpcSchema>,
    callData: `0x${string}`
  ): Promise<`0x${string}`> {
    const nonce = await client.account!.getNonce();
    const userOpHash = await client.sendUserOperation({
      callData: callData,
      nonce: nonce,
    });
    return userOpHash;
  }
}
