import { Abi } from "viem";

export type MintVehicleWithDeviceDefinition = {
  manufacturerNode: BigInt;
  owner: `0x${string}`;
  deviceDefinitionID: string;
  attributeInfo: { attribute: string; info: string }[];
  sacdInput: { grantee: `0x${string}`; permissions: BigInt; expiration: BigInt; source: string };
};

export type VehiclePermissionDescription = {
  driverID: string;
  appID: string;
  appName: string;
  expiration: BigInt;
  permissionArray: string[];
  effectiveAt: string;
};

export type SetVehiclePermissions = {
  tokenId: BigInt;
  grantee: `0x${string}`;
  permissions: BigInt;
  expiration: BigInt;
  source: string;
};

export type SetVehiclePermissionsBulk = {
  tokenIds: BigInt[];
  grantee: `0x${string}`;
  permissions: BigInt;
  expiration: BigInt;
  source: string;
};

export type SetPermissionsSACD = {
  asset: `0x${string}`;
  tokenId: BigInt;
  grantee: `0x${string}`;
  permissions: BigInt;
  expiration: BigInt;
  source: string;
};

export type BurnVehicle = {
  tokenId: BigInt;
};

export type BurnSyntheticDevice = {
  tokenId: BigInt;
};

export type SendDIMOTokens = {
  recipient: `0x${string}`;
  amount: bigint;
};

export type ClaimAftermarketDevice = {
  aftermarketDeviceNode: BigInt;
  aftermarketDeviceSig: `0x${string}`;
};

export type PairAftermarketDevice = {
  vehicleNode: BigInt;
  aftermarketDeviceNode: BigInt;
};

export type UnPairAftermarketDevice = {
  vehicleNode: BigInt;
  aftermarketDeviceNode: BigInt;
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
  vehicleIds: BigInt[];
  aftermarketDeviceIds: BigInt[];
  to: `0x${string}`;
};

export type SACDTemplateInputs = {
  appName: string;
  appID: string;
  driverID: string;
  grantee: `0x${string}`;
  grantor: `0x${string}`;
  permissions: BigInt;
  expiration: BigInt;
  attachments: string[];
};

export type DeriveKernelAddress = {
  accountAddress?: `0x${string}`;
  walletAddress?: `0x${string}`;
  waitForReceipt?: boolean;
};

export type TransactionData = {
  address: `0x${string}`;
  value?: BigInt;
  abi: Abi;
  functionName: string;
  args: any[];
};

export type TransactionInput = {
  data: TransactionData | TransactionData[];
  requireSignature?: boolean;
};

export type AddStake = {
  tokenId: BigInt;
  amount: number;
  level: number;
};

export type WithdrawStake = {
  stakeId: BigInt;
};

export type UpgradeStake = {
  stakeId: BigInt;
  level: number;
  vehicleId: BigInt;
  amountDiff: number;
};

export type AttachVehicle = {
  stakeId: BigInt;
  vehicleId: BigInt;
};

export type DetachVehicle = {
  vehicleId: BigInt;
};
