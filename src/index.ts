export { AccountSigner } from "./AccountSigner.js";
export {
  claimAftermarketDevice,
  claimAftermarketDeviceCallData,
  claimAftermarketDeviceTypeHash,
} from "./core/actions/claimAftermarketDevice.js";
export {
  mintVehicleCallData,
  mintVehicleWithDeviceDefinition,
} from "./core/actions/mintVehicleWithDeviceDefinition.js";
export {
  pairAftermarketDevice,
  pairAftermarketDeviceCallData,
  pairAftermarketDeviceTypeHash,
  pairAftermarketDeviceWithAdSig,
  pairAftermarketDeviceWithAdSigCallData,
} from "./core/actions/pairAftermarketDevice.js";
export {
  sendDIMOTokens,
  sendDIMOTokensCallData,
  sendDIMOTokensFromAccount,
  sendDIMOTokensTransactionForSignature,
} from "./core/actions/sendDIMOTokens.js";
export { setPermissionsSACD, setVehiclePermissions } from "./core/actions/setPermissionsSACD.js";
export {
  transferAllTypeHash,
  transferVehicleAndAftermarketDeviceIDs,
  transferVehicleAndAftermarketDeviceIDsCallData,
  transferVehicleAndAftermarketDeviceIDsFromAccount,
} from "./core/actions/transferVehicleAndADs.js";
export { unpairAftermarketDevice, unpairAftermarketDeviceCallData } from "./core/actions/unpairAftermarketDevice.js";
export * from "./core/constants/mappings.js";
export * from "./core/constants/methods.js";
export type {
  MintVehicleWithDeviceDefinition,
  SendDIMOTokens,
  SetVehiclePermissions,
  SetVehiclePermissionsBulk,
  TransactionData,
  TransactionInput,
  VehiclePermissionDescription,
} from "./core/types/args.js";
export { Permission } from "./core/types/args.js";
export type { SACDTemplate } from "./core/types/dimo.js";
export { ENVIRONMENT } from "./core/types/dimo.js";
export { ContractType } from "./core/types/dimo.js";
export type { VehicleNodeMintedWithDeviceDefinition } from "./core/types/responses.js";
export {
  getPermissionsArray,
  getPermissionsValue,
  newAccountConfig,
  newKernelConfig,
  sacdDescription,
} from "./core/utils/utils.js";
export { KernelSigner } from "./KernelSigner.js";

import { registerProtocol } from "@wormhole-foundation/sdk";
import { _platform as _evmPlatform } from "@wormhole-foundation/sdk-evm";
import { EvmNtt, EvmNttWithExecutor } from "@wormhole-foundation/sdk-evm-ntt";
import { _platform as _solanaPlatform } from "@wormhole-foundation/sdk-solana";
import { SolanaNtt, SolanaNttWithExecutor } from "@wormhole-foundation/sdk-solana-ntt";

// Registers the Native Token Transfer (NTT) protocol for EVM and Solana platforms
registerProtocol(_evmPlatform, "Ntt", EvmNtt);
registerProtocol(_evmPlatform, "NttWithExecutor", EvmNttWithExecutor);
registerProtocol(_solanaPlatform, "Ntt", SolanaNtt);
registerProtocol(_solanaPlatform, "NttWithExecutor", SolanaNttWithExecutor);

export { checkNttTransferStatus, initiateBridging, quoteDeliveryPrice } from "./core/actions/wormholeBridge.js";
export type { BridgeInitiateArgs, ChainRpcConfig } from "./core/types/wormhole.js";
