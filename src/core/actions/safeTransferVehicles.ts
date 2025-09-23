import { Account, Address, Chain, ParseAccount, PublicClient, RpcSchema, Transport, WalletClient } from "viem";

import { CHAIN_ABI_MAPPING, ENV_MAPPING } from ":core/constants/mappings.js";
import { ContractType, ENVIRONMENT } from ":core/types/dimo.js";

export async function safeTransferVehicleID(
  args: {
    from: `0x${string}`;
    to: `0x${string}`;
    vehicleId: bigint;
  },
  walletClient: WalletClient<Transport, Chain, ParseAccount<Account | Address>, RpcSchema>,
  publicClient: PublicClient,
  environment: string = "prod"
): Promise<`0x${string}`> {
  const contracts = CHAIN_ABI_MAPPING[ENV_MAPPING.get(environment) ?? ENVIRONMENT.PROD].contracts;

  const { request } = await publicClient.simulateContract({
    address: contracts[ContractType.DIMO_VEHICLE_ID].address,
    abi: contracts[ContractType.DIMO_VEHICLE_ID].abi,
    functionName: "safeTransferFrom",
    args: [args.from, args.to, args.vehicleId],
    account: walletClient.account,
  });

  return await walletClient.writeContract(request);
}
