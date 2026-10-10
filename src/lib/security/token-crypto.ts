// src/lib/security/token-crypto.ts
// Encrypts third-party access/refresh tokens (Google, Zoom) before they are
// stored in the database, and decrypts them when the server needs them.
//
// Algorithm: AES-256-GCM (authenticated encryption) with a random 12-byte IV
// per value. The key is derived (HKDF-SHA256) from the server environment
// variable TOKEN_ENCRYPTION_KEY, which must be a long random string (at least
// 32 characters). The key never goes in the database.
//
// Stored format:  enc:v1:<iv>.<authTag>.<ciphertext>   (each part base64url)
//
// Safe rollout:
//  - If TOKEN_ENCRYPTION_KEY is NOT set, values are stored as plain text, as
//    before, and nothing breaks.
//  - Values without the "enc:v1:" prefix are treated as legacy plain text and
//    returned unchanged, so existing connections keep working. They are
//    upgraded to encrypted storage the next time they are used (once a key is
//    configured).
//  - If a key is set but a stored value was encrypted with a different key, or
//    the value was tampered with, decryption fails and the user must reconnect.
//
// Changing TOKEN_ENCRYPTION_KEY later makes every encrypted token unreadable;
// users then simply reconnect Google/Zoom.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const MIN_KEY_LENGTH = 32;

function deriveKey(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) return null;
  if (secret.length < MIN_KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY is too short: use a random string of at least ${MIN_KEY_LENGTH} characters.`
    );
  }
  return Buffer.from(
    hkdfSync("sha256", secret, "companyos-token-encryption-salt", "integration-tokens-v1", 32)
  );
}

// True when a key is configured, i.e. new tokens will be stored encrypted.
export function encryptionEnabled(): boolean {
  return Boolean(process.env.TOKEN_ENCRYPTION_KEY);
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

// Encrypts a token for storage. Returns the value unchanged (plain text) when
// no key is configured, or when it is already encrypted.
export function encryptToken(plain: string): string {
  const key = deriveKey();
  if (!key || isEncrypted(plain)) return plain;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

// Decrypts a stored token. Legacy plain-text values are returned unchanged.
// Throws if the value is encrypted but cannot be decrypted.
export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const key = deriveKey();
  if (!key) {
    throw new Error("A stored token is encrypted but TOKEN_ENCRYPTION_KEY is not set.");
  }

  const [ivPart, tagPart, dataPart] = stored.slice(PREFIX.length).split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("A stored token is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
