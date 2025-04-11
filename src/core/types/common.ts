import { Abi, Hex } from "viem";

export type AbiAddressPair = {
    abi: Abi;
    address: Hex;
};

export type Call = {
    to: Hex
    data?: Hex | undefined
    value?: bigint | undefined
}