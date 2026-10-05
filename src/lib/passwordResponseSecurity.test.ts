import { describe, it, expect, beforeEach } from "vitest";
import {
  hashPassword,
  verifyPasswordHash,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/internal";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

describe("Password Response Security", () => {
  it("hashPassword produces valid PBKDF2 hashes", async () => {
    const hash = await hashPassword("test-password");
    expect(hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPasswordHash("test-password", hash)).toBe(true);
    expect(await verifyPasswordHash("wrong-password", hash)).toBe(false);
  });

  it("hashPassword generates unique salts for same password", async () => {
    const hash1 = await hashPassword("same-password");
    const hash2 = await hashPassword("same-password");
    // Same password should produce different hashes due to random salt
    expect(hash1).not.toBe(hash2);
    // But both should verify correctly
    expect(await verifyPasswordHash("same-password", hash1)).toBe(true);
    expect(await verifyPasswordHash("same-password", hash2)).toBe(true);
  });

  it("verifyPasswordHash rejects malformed hashes", async () => {
    expect(await verifyPasswordHash("test", "not-a-valid-hash")).toBe(false);
    expect(await verifyPasswordHash("test", "pbkdf2-sha256$10000$")).toBe(false);
  });
});
