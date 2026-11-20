/** Signs operation payloads. Signatures are base64url (no padding) 64-byte r||s over SHA-256(payload). */
export interface Signer {
  readonly didKey: string;
  sign(payload: Uint8Array): Promise<string>;
}
