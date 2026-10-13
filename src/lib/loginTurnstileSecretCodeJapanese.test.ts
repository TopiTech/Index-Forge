import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  hashPassword,
  TURNSTILE_DEFAULT_SECRET_KEY,
  verifyTurnstileToken,
  verifyAdminSecretCode,
} from "../../worker/internal";

const HIRAGANA_SECRET_CODE = "ひみつの暗号２０２６";
const KATAKANA_SECRET_CODE = "スーパーシークレットパス";
const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";

interface AttemptRecord {
  ip: string;
  failed_count: number;
  last_failed_at: number;
  locked_until: number;
}

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  secret_code_hash?: string | null;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createJapaneseSecretTestEnv() {
  const attempts = new Map<string, AttemptRecord>();
  const passwords = new Map<string, PasswordRecord>();

  const executeAll = async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM admin_login_attempts WHERE ip = ?")) {
      const ip = params[0] as string;
      const row = attempts.get(ip);
      return { results: row ? [row] : [] };
    }
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
      return { results: [] };
    }
    return { results: [] };
  };

  const executeRun = async (query: string, params: unknown[] = []) => {
    if (query.includes("INSERT INTO admin_login_attempts")) {
      const [ip, failed, last, locked] = params as [string, number, number, number];
      const existing = attempts.get(ip);
      if (existing) {
        existing.failed_count = (existing.failed_count || 0) + 1;
        existing.last_failed_at = last;
        existing.locked_until = locked;
      } else {
        attempts.set(ip, {
          ip,
          failed_count: failed,
          last_failed_at: last,
          locked_until: locked,
        });
      }
      return { success: true };
    }
    if (query.includes("DELETE FROM admin_login_attempts WHERE ip = ?")) {
      const ip = params[0] as string;
      attempts.delete(ip);
      return { success: true };
    }
    if (query.includes("INSERT INTO access_passwords") || query.includes("UPDATE access_passwords")) {
      if (query.includes("id = 'admin-master'")) {
        const existing = passwords.get("admin-master");
        if (existing) {
          if (params[0] && typeof params[0] === "string") {
            existing.secret_code_hash = params[0];
          }
        }
      }
      return { success: true };
    }
    return { success: true };
  };

  return {
    env: {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_SECRET_CODE: HIRAGANA_SECRET_CODE,
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_SECRET_KEY: TURNSTILE_DEFAULT_SECRET_KEY,
      DB: {
        prepare: (query: string) => ({
          bind: (...params: unknown[]) => ({
            all: () => executeAll(query, params),
            run: () => executeRun(query, params),
            first: async () => {
              const res = await executeAll(query, params);
              return res.results?.[0] || null;
            },
          }),
          all: () => executeAll(query),
          run: () => executeRun(query),
          first: async () => {
            const res = await executeAll(query);
            return res.results?.[0] || null;
          },
        }),
      },
    },
    attempts,
    passwords,
  };
}

describe("Japanese Hiragana and Katakana Support for Admin Secret Code & UI Authentication", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  describe("1. Backend Secret Code Verification with Hiragana & Katakana", () => {
    it("verifies secret code correctly in Hiragana", async () => {
      const { env } = createJapaneseSecretTestEnv();
      const isValid = await verifyAdminSecretCode(env as any, HIRAGANA_SECRET_CODE);
      expect(isValid).toBe(true);

      const isWrong = await verifyAdminSecretCode(env as any, "ちがうあんごう");
      expect(isWrong).toBe(false);
    });

    it("verifies secret code correctly even with NFD/NFC Unicode normalization differences", async () => {
      const { env } = createJapaneseSecretTestEnv();
      // Test with decomposed NFD (e.g., が as か + dakuten)
      const nfdHiragana = HIRAGANA_SECRET_CODE.normalize("NFD");
      const isValidNFD = await verifyAdminSecretCode(env as any, nfdHiragana);
      expect(isValidNFD).toBe(true);
    });

    it("supports Katakana secret codes stored in D1 password record", async () => {
      const { env, passwords } = createJapaneseSecretTestEnv();
      const katakanaHash = await hashPassword(KATAKANA_SECRET_CODE);
      passwords.set("admin-master", {
        id: "admin-master",
        name: "マスター管理者",
        password_hash: await hashPassword(TEST_ADMIN_PASSWORD),
        secret_code_hash: katakanaHash,
        role: "admin",
        max_stocks: null,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const isValidKatakana = await verifyAdminSecretCode(env as any, KATAKANA_SECRET_CODE);
      expect(isValidKatakana).toBe(true);

      // NFD variant should also match
      expect(await verifyAdminSecretCode(env as any, KATAKANA_SECRET_CODE.normalize("NFD"))).toBe(true);
      expect(await verifyAdminSecretCode(env as any, "ちがうカタカナ")).toBe(false);
    });

    it("authenticates via /api/auth/admin-login using Hiragana secret code", async () => {
      const { env } = createJapaneseSecretTestEnv();
      const req = new Request("https://indexforge.test/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: HIRAGANA_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(true);
      expect(data.role).toBe("admin");
    });
  });

  describe("2. UI Component Contracts: AuthModal", () => {
    const authModalCode = readFileSync(resolve(process.cwd(), "src/components/AuthModal.tsx"), "utf-8");

    it("renders TurnstileWidget in AuthModal", () => {
      expect(authModalCode).toContain("<TurnstileWidget");
      expect(authModalCode).toContain("turnstileRef");
      expect(authModalCode).toContain("getTurnstileConfig");
    });

    it("renders secret code input with full Hiragana/Katakana IME support", () => {
      expect(authModalCode).toContain('id="auth-modal-secret-code-input"');
      expect(authModalCode).toContain('inputMode="text"');
      expect(authModalCode).toContain('lang="ja"');
      expect(authModalCode).toContain("WebkitTextSecurity");
      expect(authModalCode).toMatch(/ひらがな.*カタカナ/);
    });

    it("provides admin and user authentication mode tabs", () => {
      expect(authModalCode).toContain('role="tablist"');
      expect(authModalCode).toContain("管理者ログイン");
      expect(authModalCode).toContain("一般ユーザー");
    });

    it("normalizes secret code to NFC on submission", () => {
      expect(authModalCode).toMatch(/secretCode\.normalize\("NFC"\)/);
    });
  });

  describe("3. UI Component Contracts: PortfolioManagerPage", () => {
    const portfolioCode = readFileSync(
      resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
      "utf-8",
    );

    it("renders TurnstileWidget in PortfolioManagerPage auth gate", () => {
      expect(portfolioCode).toContain("<TurnstileWidget");
      expect(portfolioCode).toContain("getTurnstileConfig");
    });

    it("renders secret code input with Hiragana/Katakana IME support in PortfolioManagerPage", () => {
      expect(portfolioCode).toContain('id="portfolio-secret-code-input"');
      expect(portfolioCode).toContain('inputMode="text"');
      expect(portfolioCode).toContain('lang="ja"');
      expect(portfolioCode).toContain("WebkitTextSecurity");
      expect(portfolioCode).toMatch(/ひらがな.*カタカナ/);
    });

    it("supports admin login and normalizes secret code to NFC", () => {
      expect(portfolioCode).toMatch(/adminLogin/);
      expect(portfolioCode).toMatch(/authSecretCode\.normalize\("NFC"\)/);
    });
  });

  describe("4. UI Component Contracts: AdminDashboard", () => {
    const adminDashboardCode = readFileSync(
      resolve(process.cwd(), "src/components/AdminDashboard.tsx"),
      "utf-8",
    );

    it("has WebkitTextSecurity and IME support on admin secret code inputs", () => {
      expect(adminDashboardCode).toContain('id="admin-secret-code-input"');
      expect(adminDashboardCode).toContain('inputMode="text"');
      expect(adminDashboardCode).toContain('lang="ja"');
      expect(adminDashboardCode).toContain("WebkitTextSecurity: showAdminSecretCode");
      expect(adminDashboardCode).toMatch(/ひらがな.*カタカナ/);
    });

    it("normalizes secret codes to NFC in AdminDashboard", () => {
      expect(adminDashboardCode).toMatch(/adminSecretCodeInput\.normalize\("NFC"\)/);
    });
  });
});
