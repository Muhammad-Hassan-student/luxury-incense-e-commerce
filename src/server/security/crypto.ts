import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url. Used for tickets, enrollment links and WebAuthn user handles. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Tokens are only ever stored as SHA-256 hashes. */
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const randomCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is required for sign-in security.");
  return s;
}

const derive = (ikm: string | Buffer, info: string) => Buffer.from(hkdfSync("sha256", ikm, "maison-oud/second-step", info, 32));

/** HMAC of an emailed code, bound to the code row so a hash can't be reused for another request. */
export const hashCode = (codeId: string, code: string) => createHmac("sha256", derive(secret(), "email-code-v1")).update(`${codeId}:${code}`).digest("hex");

export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

/** Face-embedding key: FACE_ENCRYPTION_KEY if set (any string, run through HKDF), else derived from AUTH_SECRET. */
function faceKey() {
  const dedicated = process.env.FACE_ENCRYPTION_KEY;
  return derive(dedicated && dedicated.length >= 16 ? dedicated : secret(), "face-embedding-v1");
}

/** AES-256-GCM; the user id is authenticated data, so a row copied to another account won't decrypt. */
export function encryptEmbedding(embedding: Float32Array, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", faceKey(), iv);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const plain = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptEmbedding(stored: string, userId: string): Float32Array {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unknown face template format");
  const decipher = createDecipheriv("aes-256-gcm", faceKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  const out = new Float32Array(plain.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = plain.readFloatLE(i * 4);
  return out;
}
