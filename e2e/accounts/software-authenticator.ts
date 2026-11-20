import { createHash, generateKeyPairSync, KeyObject, randomBytes, sign } from "crypto";

// A passkey made and used in software (node crypto), standing in for a
// browser's: an attestation object as registration stores it, and assertions
// as navigator.credentials.get() returns them (base64url, as toJSON writes).

export const RP_ID = "dimo.org";
export const ORIGIN = "https://login.dimo.org";

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();

const uint = (bytes: number, value: number) => {
  const buffer = Buffer.alloc(bytes);
  buffer.writeUIntBE(value, 0, bytes);
  return buffer;
};

// Just enough CBOR for an attestation object and a COSE key.
const head = (major: number, length: number) => {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
  return Buffer.concat([Buffer.from([(major << 5) | 25]), uint(2, length)]);
};
type Cbor = number | string | Buffer | Map<Cbor, Cbor>;
const cbor = (value: Cbor): Buffer => {
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const text = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, text.length), text]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
};

const coseKey = (publicKey: KeyObject, algorithm: "ES256" | "RS256") => {
  const jwk = publicKey.export({ format: "jwk" });
  const bytes = (field?: string) => Buffer.from(field!, "base64url");
  return algorithm === "ES256"
    ? new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, bytes(jwk.x)],
        [-3, bytes(jwk.y)],
      ])
    : new Map<Cbor, Cbor>([
        [1, 3], // kty: RSA
        [3, -257], // alg: RS256
        [-1, bytes(jwk.n)],
        [-2, bytes(jwk.e)],
      ]);
};

export interface Assertion {
  id: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  };
}

export const makePasskey = ({
  algorithm = "ES256",
  rpId = RP_ID,
}: { algorithm?: "ES256" | "RS256"; rpId?: string } = {}) => {
  const { privateKey, publicKey } =
    algorithm === "ES256"
      ? generateKeyPairSync("ec", { namedCurve: "P-256" })
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rawId = randomBytes(32);
  const credentialId = rawId.toString("base64url");

  const authData = Buffer.concat([
    sha256(rpId),
    Buffer.from([FLAG_UP | FLAG_UV | FLAG_AT]),
    uint(4, 0),
    Buffer.alloc(16), // AAGUID
    uint(2, rawId.length),
    rawId,
    cbor(coseKey(publicKey, algorithm)),
  ]);
  const attestationObject = cbor(
    new Map<Cbor, Cbor>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ])
  ).toString("base64url");

  /** An assertion over `challenge`, made as a browser would, unless told otherwise. */
  const assert = ({
    challenge,
    origin = ORIGIN,
    type = "webauthn.get",
    assertedRpId = rpId,
    flags = FLAG_UP | FLAG_UV,
    signer = privateKey,
  }: {
    challenge: string;
    origin?: string;
    type?: string;
    assertedRpId?: string;
    flags?: number;
    signer?: KeyObject;
  }): Assertion => {
    const clientDataJSON = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
    const authenticatorData = Buffer.concat([sha256(assertedRpId), Buffer.from([flags]), uint(4, 1)]);
    const signature = sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), signer);
    return {
      id: credentialId,
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  };

  return {
    credentialId,
    attestationObject,
    // As the Authenticator row stores it.
    stored: { credentialId, attestationObject },
    assert,
  };
};

export const FLAGS = { UP: FLAG_UP, UV: FLAG_UV };
