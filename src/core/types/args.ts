import { Abi } from "viem";

export type MintVehicleWithDeviceDefinition = {
  manufacturerNode: bigint;
  owner: `0x${string}`;
  deviceDefinitionID: string;
  attributeInfo: { attribute: string; info: string }[];
};

export type VehiclePermissionDescription = {
  driverID: string;
  appID: string;
  appName: string;
  expiration: bigint;
  permissionArray: string[];
  effectiveAt: string;
};

export type SetVehiclePermissions = {
  tokenId: bigint;
  grantee: `0x${string}`;
  permissions: Permission[];
  expiration: bigint;
  source: string;
};

export type SetVehiclePermissionsBulk = {
  tokenIds: bigint[];
  grantee: `0x${string}`;
  permissions: Permission[];
  expiration: bigint;
  source: string;
};

export type SetPermissionsSACD = {
  asset: `0x${string}`;
  tokenId: bigint;
  grantee: `0x${string}`;
  permissions: Permission[];
  expiration: bigint;
  source: string;
};

export type BurnVehicle = {
  tokenId: bigint;
};

export type BurnSyntheticDevice = {
  tokenId: bigint;
};

export type SendDIMOTokens = {
  recipient: `0x${string}`;
  amount: bigint;
};

export type ClaimAftermarketDevice = {
  aftermarketDeviceNode: bigint;
  aftermarketDeviceSig: `0x${string}`;
};

export type PairAftermarketDevice = {
  vehicleNode: bigint;
  aftermarketDeviceNode: bigint;
};

export type PairAftermarketDeviceWithAdSig = {
  vehicleNode: bigint;
  aftermarketDeviceNode: bigint;
  aftermarketDeviceSig: `0x${string}`;
};

export type UnPairAftermarketDevice = {
  vehicleNode: bigint;
  aftermarketDeviceNode: bigint;
};

export type ConnectPrivateKeyParams = {
  privateKey: `0x${string}`;
};

export type ConnectTurnkeyParams = {
  organizationId: string;
  turnkeyApiPublicKey: string;
  turnkeyApiPrivateKey: string;
  signer: `0x${string}`;
  turnkeyBaseURL: string;
};

export type ClientConfigDimo = {
  rpcURL: string;
  bundlrURL: string;
  paymasterURL: string;
  chainExplorerURL: string;

  environment: string;
};

export type TransferVehicleAndAftermarketDeviceIDs = {
  vehicleIds: bigint[];
  aftermarketDeviceIds: bigint[];
  to: `0x${string}`;
};

export const MAX_PERMISSION_INDEX = 8; // Maximum number of permissions that can be granted in a single SACD template

export enum Permission {
  GetNonLocationHistory = 1, // All-time non-location data
  ExecuteCommands = 2, // Commands
  GetCurrentLocation = 3, // Current location
  GetLocationHistory = 4, // All-time location
  GetVINCredential = 5, // View VIN credential
  GetLiveData = 6, // Subscribe live data
  GetRawData = 7, // Raw data
  GetApproximateLocation = 8, // Approximate location
}

export type PermissionsSACDTemplateInputs = {
  grantor: `0x${string}`;
  grantee: `0x${string}`;
  asset: `did:${string}`;
  permissions: Permission[];
  attachments: { name: string; description: string; contentType: string; url: string }[];
  expiration: bigint;
};

export type DeriveKernelAddress = {
  accountAddress?: `0x${string}`;
  walletAddress?: `0x${string}`;
  waitForReceipt?: boolean;
};

export type TransactionData = {
  address: `0x${string}`;
  value?: bigint;
  abi: Abi;
  functionName: string;
  args: any[];
};

export type TransactionInput = {
  data: TransactionData | TransactionData[];
  requireSignature?: boolean;
};

export type AddStake = {
  tokenId: bigint;
  amount: number;
  level: number;
};

export type WithdrawStake = {
  stakeId: bigint;
};

export type UpgradeStake = {
  stakeId: bigint;
  level: number;
  vehicleId: bigint;
  amountDiff: number;
};

export type AttachVehicle = {
  stakeId: bigint;
  vehicleId: bigint;
};

export type DetachVehicle = {
  vehicleId: bigint;
};
