export type UnsignedOperation = {
  type: "plc_operation" | "plc_tombstone";
  rotationKeys: string[];
  verificationMethods: Record<string, string>;
  alsoKnownAs: string[];
  services: Record<string, { type: string; endpoint: string }>;
  prev: string | null;
};

export type Operation = UnsignedOperation & { sig: string };

export type KeyCurve = "p256" | "secp256k1";
