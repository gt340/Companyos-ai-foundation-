import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken, encryptionEnabled, isEncrypted } from "./token-crypto";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("integration token encryption", () => {
  it("fails closed instead of storing new tokens in plain text without a key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(encryptionEnabled()).toBe(false);
    expect(() => encryptToken("access-token")).toThrow(/TOKEN_ENCRYPTION_KEY must be configured/);
  });

  it("encrypts and decrypts tokens when a sufficiently long key is configured", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-only-random-secret-that-is-long-enough-123456789");
    const encrypted = encryptToken("access-token");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain("access-token");
    expect(decryptToken(encrypted)).toBe("access-token");
  });

  it("continues to read legacy plaintext values for migration", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(decryptToken("legacy-plain-token")).toBe("legacy-plain-token");
  });

  it("rejects encrypted values when the encryption key is missing", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => decryptToken("enc:v1:iv.tag.ciphertext")).toThrow(/TOKEN_ENCRYPTION_KEY must be configured/);
  });
});
