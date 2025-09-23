export type VehicleNodeMintedWithDeviceDefinition = {
  manufacturerId: bigint;
  vehicleId: bigint;
  owner: `0x${string}`;
  deviceDefinitionId: string;
};

export type TypeHashResponse = {
  hash: string;
  payload: {
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    types: Record<
      string,
      {
        name: string;
        type: string;
      }[]
    >;
    message: Record<string, bigint | `0x${string}`>;
  };
};
