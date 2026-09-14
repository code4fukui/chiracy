const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  return base64ToBytes(normalized);
}

export type CborValue =
  | number
  | string
  | Uint8Array<ArrayBuffer>
  | CborValue[]
  | Map<number | string, CborValue>;

export function decodeCbor(bytes: Uint8Array): CborValue {
  let offset = 0;
  const read = (size: number) => {
    if (offset + size > bytes.length) throw new Error("Invalid CBOR");
    const value = bytes.slice(offset, offset + size);
    offset += size;
    return value;
  };
  const length = (additional: number): number => {
    if (additional < 24) return additional;
    if (additional === 24) return read(1)[0];
    if (additional === 25) return new DataView(read(2).buffer).getUint16(0);
    if (additional === 26) return new DataView(read(4).buffer).getUint32(0);
    throw new Error("Unsupported CBOR length");
  };
  const item = (): CborValue => {
    const head = read(1)[0];
    const major = head >> 5;
    const additional = head & 31;
    if (additional === 31) throw new Error("Indefinite CBOR is not supported");
    if (major === 0) return length(additional);
    if (major === 1) return -1 - length(additional);
    if (major === 2) return read(length(additional));
    if (major === 3) return new TextDecoder().decode(read(length(additional)));
    if (major === 4) return Array.from({ length: length(additional) }, item);
    if (major === 5) {
      const map = new Map<number | string, CborValue>();
      for (let index = 0, count = length(additional); index < count; index++) {
        const key = item();
        if (typeof key !== "number" && typeof key !== "string") {
          throw new Error("Invalid CBOR map key");
        }
        map.set(key, item());
      }
      return map;
    }
    if (major === 7 && additional === 20) return 0;
    if (major === 7 && additional === 21) return 1;
    throw new Error("Unsupported CBOR value");
  };
  const result = item();
  if (offset !== bytes.length) throw new Error("Trailing CBOR data");
  return result;
}

function concat(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(
    values.reduce((sum, value) => sum + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function sha256(value: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(value)),
  );
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function clientDataInfo(
  clientDataJSON: Uint8Array,
  challenge: string,
  origin: string,
  expectedType: "webauthn.create" | "webauthn.get",
): void {
  const data = JSON.parse(new TextDecoder().decode(clientDataJSON)) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  if (data.type !== expectedType) {
    throw new Error("Invalid WebAuthn type");
  }
  if (data.challenge !== challenge || data.origin !== origin) {
    throw new Error("Invalid WebAuthn client data");
  }
}

export type WebAuthnCredential = {
  credentialId: string;
  publicKey: string;
  signCount: number;
};

export async function parseRegistration(
  clientDataJSON: Uint8Array,
  attestationObject: Uint8Array,
  challenge: string,
  origin: string,
  rpId: string,
): Promise<WebAuthnCredential> {
  clientDataInfo(clientDataJSON, challenge, origin, "webauthn.create");
  const attestation = decodeCbor(attestationObject);
  if (!(attestation instanceof Map)) throw new Error("Invalid attestation");
  const authData = attestation.get("authData");
  if (!(authData instanceof Uint8Array) || authData.length < 55) {
    throw new Error("Invalid authenticator data");
  }
  const expectedRpHash = await sha256(new TextEncoder().encode(rpId));
  if (
    !equalBytes(authData.slice(0, 32), expectedRpHash) || !(authData[32] & 1)
  ) {
    throw new Error("Invalid relying party or user presence");
  }
  if (!(authData[32] & 64)) {
    throw new Error("Resident credential data is missing");
  }
  const idLength = new DataView(authData.buffer, authData.byteOffset + 53, 2)
    .getUint16(0);
  const idStart = 55;
  const credentialId = authData.slice(idStart, idStart + idLength);
  const cose = decodeCbor(authData.slice(idStart + idLength));
  if (
    !(cose instanceof Map) || cose.get(1) !== 2 || cose.get(3) !== -7 ||
    cose.get(-1) !== 1
  ) {
    throw new Error("Only ES256 passkeys are supported");
  }
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (
    !(x instanceof Uint8Array) || !(y instanceof Uint8Array) ||
    x.length !== 32 || y.length !== 32
  ) {
    throw new Error("Invalid passkey public key");
  }
  return {
    credentialId: bytesToBase64Url(credentialId),
    publicKey: JSON.stringify({
      x: bytesToBase64Url(x),
      y: bytesToBase64Url(y),
    }),
    signCount: readUint32(authData, 33),
  };
}

function derToRaw(signature: Uint8Array): Uint8Array<ArrayBuffer> {
  if (signature[0] !== 0x30) throw new Error("Invalid signature");
  let offset = 2;
  if (signature[1] & 0x80) offset += signature[1] & 0x7f;
  if (signature[offset++] !== 0x02) throw new Error("Invalid signature");
  const rLength = signature[offset++];
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error("Invalid signature");
  const sLength = signature[offset++];
  const s = signature.slice(offset, offset + sLength);
  const raw = new Uint8Array(64);
  raw.set(r.slice(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  raw.set(s.slice(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));
  return raw;
}

export async function verifyAssertion(
  clientDataJSON: Uint8Array,
  authenticatorData: Uint8Array,
  signature: Uint8Array,
  challenge: string,
  origin: string,
  rpId: string,
  publicKey: string,
  previousSignCount: number,
): Promise<number> {
  clientDataInfo(clientDataJSON, challenge, origin, "webauthn.get");
  if (authenticatorData.length < 37 || !(authenticatorData[32] & 1)) {
    throw new Error("Invalid authenticator data");
  }
  const expectedRpHash = await sha256(new TextEncoder().encode(rpId));
  if (!equalBytes(authenticatorData.slice(0, 32), expectedRpHash)) {
    throw new Error("Invalid relying party");
  }
  const signCount = readUint32(authenticatorData, 33);
  if (
    previousSignCount > 0 && signCount > 0 && signCount <= previousSignCount
  ) {
    throw new Error("Invalid signature counter");
  }
  const key = JSON.parse(publicKey) as { x?: string; y?: string };
  if (!key.x || !key.y) throw new Error("Invalid public key");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    concat(
      new Uint8Array([0x04]),
      base64UrlToBytes(key.x),
      base64UrlToBytes(key.y),
    ),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const clientHash = await sha256(clientDataJSON);
  const signedData = concat(authenticatorData, clientHash);
  let validRaw = false;
  try {
    validRaw = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      derToRaw(signature),
      signedData,
    );
  } catch {
    validRaw = false;
  }
  if (!validRaw) {
    const validDer = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      new Uint8Array(signature),
      signedData,
    );
    if (!validDer) throw new Error("Invalid passkey signature");
  }
  return signCount;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const iterations = 210_000;
  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256,
    ),
  );
  return `pbkdf2-sha256$${iterations}$${bytesToBase64(salt)}$${
    bytesToBase64(hash)
  }`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, iterationText, saltText, expectedText] = encoded.split("$");
  if (
    algorithm !== "pbkdf2-sha256" || !iterationText || !saltText ||
    !expectedText
  ) return false;
  const iterations = Number(iterationText);
  if (!Number.isSafeInteger(iterations) || iterations < 1) return false;
  try {
    const salt = base64ToBytes(saltText);
    const expected = base64ToBytes(expectedText);
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const actual = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations },
        key,
        expected.byteLength * 8,
      ),
    );
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) {
      difference |= actual[index] ^ expected[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}

export function randomId(bytes = 24): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
