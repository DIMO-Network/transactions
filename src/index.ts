export { ENVIRONMENT } from "./core/types/dimo.js";
export type { SACDTemplate } from "./core/types/dimo.js";
export type {
  MintVehicleWithDeviceDefinition,
  SendDIMOTokens,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
  SetAccountPermissions,
  TransactionData,
  TransactionInput,
  VehiclePermissionDescription,
} from "./core/types/args.js";
export { ContractType } from "./core/types/dimo.js";
export { Permission } from "./core/types/args.js";
export type { VehicleNodeMintedWithDeviceDefinition } from "./core/types/responses.js";
export * from "./core/constants/mappings.js";
export * from "./core/constants/methods.js";
export {
  mintVehicleWithDeviceDefinition,
  mintVehicleCallData,
} from "./core/actions/mintVehicleWithDeviceDefinition.js";
export { setVehiclePermissions, setPermissionsSACD } from "./core/actions/setPermissionsSACD.js";
export {
  setAccountPermissions,
  setAccountPermissionsCallData,
} from "./core/actions/setAccountPermissionsSACD.js";
export {
  transferVehicleAndAftermarketDeviceIDsCallData,
  transferVehicleAndAftermarketDeviceIDs,
  transferVehicleAndAftermarketDeviceIDsFromAccount,
  transferAllTypeHash,
} from "./core/actions/transferVehicleAndADs.js";
export {
  sendDIMOTokens,
  sendDIMOTokensCallData,
  sendDIMOTokensFromAccount,
  sendDIMOTokensTransactionForSignature,
} from "./core/actions/sendDIMOTokens.js";
export {
  claimAftermarketDeviceCallData,
  claimAftermarketDevice,
  claimAftermarketDeviceTypeHash,
} from "./core/actions/claimAftermarketDevice.js";
export {
  pairAftermarketDeviceCallData,
  pairAftermarketDevice,
  pairAftermarketDeviceTypeHash,
  pairAftermarketDeviceWithAdSigCallData,
  pairAftermarketDeviceWithAdSig
} from "./core/actions/pairAftermarketDevice.js";
export { unpairAftermarketDeviceCallData, unpairAftermarketDevice } from "./core/actions/unpairAftermarketDevice.js";
export {
  newAccountConfig,
  newKernelConfig,
  sacdDescription,
  getPermissionsValue,
  getPermissionsArray,
} from "./core/utils/utils.js";
export { KernelSigner } from "./KernelSigner.js";
export { AccountSigner } from "./AccountSigner.js";

import { registerProtocol } from "@wormhole-foundation/sdk";
import { EvmNtt, EvmNttWithExecutor } from "@wormhole-foundation/sdk-evm-ntt";
import { SolanaNtt, SolanaNttWithExecutor } from "@wormhole-foundation/sdk-solana-ntt";
import { _platform as _evmPlatform } from "@wormhole-foundation/sdk-evm";
import { _platform as _solanaPlatform} from "@wormhole-foundation/sdk-solana";

// Registers the Native Token Transfer (NTT) protocol for EVM and Solana platforms
registerProtocol(_evmPlatform, "Ntt", EvmNtt);
registerProtocol(_evmPlatform, "NttWithExecutor", EvmNttWithExecutor);
registerProtocol(_solanaPlatform, "Ntt", SolanaNtt);
registerProtocol(_solanaPlatform, "NttWithExecutor", SolanaNttWithExecutor);

export { initiateBridging, quoteDeliveryPrice, checkNttTransferStatus } from "./core/actions/wormholeBridge.js";
export type { BridgeInitiateArgs, ChainRpcConfig } from "./core/types/wormhole.js";
