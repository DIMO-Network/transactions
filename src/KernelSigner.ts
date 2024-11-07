import { ContractToMapping, DIMO_APIs, ENVIRONMENT, KernelConfig, _kernelConfig } from ":core/types/dimo.js";
import { Chain, PublicClient, Transport, WalletClient, createPublicClient, createWalletClient, http } from "viem";
import {
  KernelAccountClient,
  KernelSmartAccount,
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  getCustomNonceKeyFromString,
} from "@zerodev/sdk";
import { EntryPoint } from "permissionless/types";
import { BundlerClient, GetUserOperationReceiptReturnType, createBundlerClient } from "permissionless";
import {
  mintVehicleWithDeviceDefinition,
  mintVehicleWithDeviceDefinitionBatch,
} from ":core/actions/mintVehicleWithDeviceDefinition.js";
import {
  setVehiclePermissions,
  setVehiclePermissionsBatch,
  setVehiclePermissionsBulk,
} from ":core/actions/setPermissionsSACD.js";
import {
  CHAIN_ABI_MAPPING,
  ENV_MAPPING,
  ENV_NETWORK_MAPPING,
  ENV_TO_API_MAPPING,
  OnChainErrors,
} from ":core/constants/mappings.js";
import {
  BurnVehicle,
  ClaimAftermarketdevice,
  MintVehicleWithDeviceDefinition,
  PairAftermarketDevice,
  SendDIMOTokens,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
  TransferVehicleAndAftermarketDeviceIDs,
  UnPairAftermarketDevice,
} from ":core/types/args.js";
import { claimAftermarketDevice, claimAftermarketDeviceTypeHash } from ":core/actions/claimAftermarketDevice.js";
import { TypeHashResponse } from ":core/types/responses.js";
import { sendDIMOTokens } from ":core/actions/sendDIMOTokens.js";
import { pairAftermarketDevice } from ":core/actions/pairAftermarketDevice.js";
import { TurnkeyClient } from "@turnkey/http";
import { polygon } from "viem/chains";
import { burnVehicle, burnVehicleBatch } from ":core/actions/burnVehicle.js";
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
  contractMapping: ContractToMapping;
  chain: Chain;
  kernelAddress: `0x${string}` | undefined;
  _init: boolean = false;
  subOrganizationId: string | undefined;
  walletAddress: `0x${string}` | undefined;
  smartContractAddress: `0x${string}` | undefined;
  apiSessionClient: {
    expires: number;
    client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>;
  } = {
    client: undefined,
    expires: 0,
  };
  passkeyClient: {
    turnkeyClient: TurnkeyClient | undefined;
    valid: boolean;
    client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>;
  } = {
    turnkeyClient: undefined,
    valid: false,
    client: undefined,
  };
  passkeySessionClient: {
    expires: number;
    client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>;
  } = {
    expires: 0,
    client: undefined,
  };
  privateKeyClient: {
    valid: boolean;
    client: KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>;
  } = {
    valid: false,
    client: undefined,
  };
  authBaseUrl: string;

  constructor(config: KernelConfig) {
    this.config = config as _kernelConfig;
    this.chain =
      ENV_NETWORK_MAPPING.get(ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD) ?? polygon;
    this.contractMapping =
      CHAIN_ABI_MAPPING[ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD].contracts;
    this.authBaseUrl =
      ENV_TO_API_MAPPING[ENV_MAPPING.get(this.config.environment ?? "prod") ?? ENVIRONMENT.PROD][DIMO_APIs.AUTH].url;
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

  public async getActiveClient(): Promise<
    KernelAccountClient<EntryPoint, Transport, Chain, KernelSmartAccount<EntryPoint, Transport, Chain>>
  > {
    if (this.config.usePrivateKey) {
      return this.privateKeyClient.client;
    }

    if (new Date(this.apiSessionClient.expires) > new Date(Date.now())) {
      return this.apiSessionClient.client;
    }

    if (new Date(this.passkeySessionClient.expires) > new Date(Date.now())) {
      return this.passkeySessionClient.client;
    } else {
      try {
        if (this.config.useWalletSession) {
          await this.openSessionWithPasskey();
          if (new Date(this.passkeySessionClient.expires) > new Date(Date.now())) {
            return this.passkeySessionClient.client;
          }
        }
      } catch {
        if (this.passkeyClient.valid) {
          return this.passkeyClient.client;
        }
      }
    }

    throw new Error("No active client");
  }

  public async passkeyInit(subOrganizationId: string, walletAddress: `0x${string}`, stamper: any) {
    if (!this._init) {
      this._init = true;
      this.subOrganizationId = subOrganizationId;
      this.walletAddress = walletAddress;
    }

    this.passkeyClient.turnkeyClient = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, stamper);

    const localAccount = await createAccount({
      // @ts-ignore
      client: this.turnkeyPasskeyClient,
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

    this.passkeyClient.client = createKernelAccountClient({
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

    this.passkeyClient.valid = true;
    this.kernelAddress = account.address;
    this.smartContractAddress = account.address;
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
    if (!this.walletAddress) {
      throw new Error("Wallet address not set");
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
    const localAccount = await createAccount({
      // @ts-ignore
      client: turnkeyClient,
      organizationId: this.subOrganizationId,
      signWith: this.walletAddress,
      ethereumAddress: this.walletAddress,
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

    this.passkeySessionClient.client = createKernelAccountClient({
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

    this.passkeySessionClient.expires = expiration;
    return;
  }

  public async openSessionWithApiStamper(subOrganizationId: string, apiStamper: any) {
    const timestamp = Date.now();
    const expiration = timestamp + parseInt(this.config.sessionTimeoutSeconds) * 0.75 * 1000;

    const client = new TurnkeyClient({ baseUrl: this.config.turnkeyApiBaseUrl }, apiStamper);

    const wallets = await client.getWallets({ organizationId: subOrganizationId });
    const walletAddr = await client.getWalletAccounts({
      organizationId: subOrganizationId,
      walletId: wallets.wallets[0].walletId,
    });

    this.walletAddress = walletAddr.accounts[0].address as `0x${string}`;
    this.subOrganizationId = subOrganizationId;

    const localAccount = await createAccount({
      // @ts-ignore
      client: client,
      organizationId: this.subOrganizationId!,
      signWith: this.walletAddress!,
      ethereumAddress: this.walletAddress,
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

    this.apiSessionClient.client = createKernelAccountClient({
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
    this.apiSessionClient.expires = expiration;
    return;
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

    this.privateKeyClient.valid = true;
    this.privateKeyClient.client = createKernelAccountClient({
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
    args: MintVehicleWithDeviceDefinition | MintVehicleWithDeviceDefinition[],
    waitForReceipt: boolean = true
  ): Promise<GetUserOperationReceiptReturnType & { userOperationHash: string }> {
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

    const nonceKey = getCustomNonceKeyFromString(Date.now().toString(), this.config.entryPoint);
    const nonce = await client.account.getNonce(nonceKey);

    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: mintVehicleCallData as `0x${string}`,
        nonce: nonce,
      },
    });

    if (!waitForReceipt) {
      return {
        userOperationHash: userOpHash,
        status: "pending",
      };
    }

    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });

    return txResult;
  }

  public async setVehiclePermissions(
    args: SetVehiclePermissions | SetVehiclePermissions[]
  ): Promise<GetUserOperationReceiptReturnType> {
    const client = await this.getActiveClient();
    let setVehiclePermissionsCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      setVehiclePermissionsCallData = await setVehiclePermissions(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch minting limit: 25");
      }
      setVehiclePermissionsCallData = await setVehiclePermissionsBatch(args, client, this.config.environment);
    }

    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: setVehiclePermissionsCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async setVehiclePermissionsBulk(args: SetVehiclePermissionsBulk): Promise<GetUserOperationReceiptReturnType> {
    const client = await this.getActiveClient();
    const setVehiclePermissionsBulkCallData = await setVehiclePermissionsBulk(args, client, this.config.environment);

    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: setVehiclePermissionsBulkCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async sendDIMOTokens(args: SendDIMOTokens): Promise<GetUserOperationReceiptReturnType> {
    if (!this.passkeyClient.valid) {
      throw new Error("Tokens must be sent with passkey client");
    }

    const sendDIMOTokensCallData = await sendDIMOTokens(args, this.passkeyClient.client, this.config.environment);
    const userOpHash = await this.passkeyClient.client.sendUserOperation({
      userOperation: {
        callData: sendDIMOTokensCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public claimAftermarketDeviceTypeHash(aftermarketDeviceNode: bigint, owner: `0x${string}`): TypeHashResponse {
    return claimAftermarketDeviceTypeHash(aftermarketDeviceNode, owner, this.config.environment);
  }

  public async claimAftermarketDevice(args: ClaimAftermarketdevice): Promise<GetUserOperationReceiptReturnType> {
    const client = await this.getActiveClient();

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
    const client = await this.getActiveClient();

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
    const client = await this.getActiveClient();

    const claimAndPairCallData = await claimAndPairDevice(args, client, this.config.environment);
    const claimAndPairADHash = await client.sendUserOperation({
      userOperation: {
        callData: claimAndPairCallData as `0x${string}`,
      },
    });

    const result = await this.bundlerClient.waitForUserOperationReceipt({ hash: claimAndPairADHash });
    return result;
  }

  public async burnVehicle(args: BurnVehicle | BurnVehicle[]): Promise<GetUserOperationReceiptReturnType> {
    const client = await this.getActiveClient();

    let burnVehicleCallData: `0x${string}`;
    if (!Array.isArray(args)) {
      burnVehicleCallData = await burnVehicle(args, client, this.config.environment);
    } else {
      if (args.length >= 25) {
        throw Error("Batch minting limit: 25");
      }
      burnVehicleCallData = await burnVehicleBatch(args, client, this.config.environment);
    }

    let userOpHash: `0x${string}`;
    try {
      userOpHash = await client.sendUserOperation({
        userOperation: {
          callData: burnVehicleCallData as `0x${string}`,
        },
      });
      const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
      return txResult;
    } catch (error: any) {
      if (error) {
        error = error.toString();
      }
      for (const [failReason, cleanError] of Object.entries(OnChainErrors)) {
        if (error.includes(failReason)) {
          throw new Error(cleanError);
        }
        throw new Error(error);
      }
    }
  }

  public async transferVehicleAndAftermarketDevices(
    args: TransferVehicleAndAftermarketDeviceIDs
  ): Promise<GetUserOperationReceiptReturnType> {
    const client = await this.getActiveClient();

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
    const client = await this.getActiveClient();
    const unpairADCallData = await unpairAftermarketDevice(args, client, this.config.environment);
    const userOpHash = await client.sendUserOperation({
      userOperation: {
        callData: unpairADCallData as `0x${string}`,
      },
    });
    const txResult = await this.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    return txResult;
  }

  public async signTypedData(arg: any): Promise<any> {
    const client = (await this.getActiveClient()) as KernelAccountClient<
      EntryPoint,
      Transport,
      Chain,
      KernelSmartAccount<EntryPoint, Transport, Chain>
    >;

    return client.signTypedData(arg);
  }

  public async signChallenge(challenge: string): Promise<`0x${string}`> {
    let client = (await this.getActiveClient()) as WalletClient;

    return client.signMessage({
      account: client.account!,
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
        return { success: false, error: errorData.message || "Failed to generate challenge" };
      }

      const data = await response.json();
      return { success: true, data: data };
    } catch (error) {
      console.error("Error generating challenge:", error);
      return { success: false, error: "An error occurred while generating challenge" };
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
        return { success: false, error: errorData.message || "Failed to submit challenge" };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error("Error submitting web3 challenge:", error);
      return { success: false, error: "An error occurred while submitting challenge" };
    }
  }
}
