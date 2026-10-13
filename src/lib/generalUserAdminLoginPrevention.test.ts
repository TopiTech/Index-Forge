import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import worker from "../../worker/index";
import { verifyPassword, clearAuth, getStoredAuth } from "./auth";
import { hashPassword } from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";
const TEST_USER_PASSWORD = "test-general-user-pwd-2026";

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createMockEnv() {
  const passwords = new Map<string, PasswordRecord>();

  return {
    env: {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_SECRET_CODE: "テスト暗号",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_SECRET_KEY: "test-secret-key",
      DB: {
        prepare: (query: string) => ({
          bind: (..._params: unknown[]) => ({
            all: async () => {
              if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
                const master = passwords.get("admin-master");
                return { results: master ? [master] : [] };
              }
              if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
                const rows = Array.from(passwords.values()).filter(
                  (p) => p.is_active === 1 && p.id !== "admin-master",
                );
                return { results: rows };
              }
              return { results: [] };
            },
            run: async () => ({ success: true, meta: { changes: 1 } }),
          }),
          all: async () => {
            if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              const master = passwords.get("admin-master");
              return { results: master ? [master] : [] };
            }
            if (query.includes("FROM access_passwords WHERE is_active = 1 AND id != 'admin-master'")) {
              const rows = Array.from(passwords.values()).filter(
                (p) => p.is_active === 1 && p.id !== "admin-master",
              );
              return { results: rows };
            }
            return { results: [] };
          },
          run: async () => ({ success: true, meta: { changes: 1 } }),
        }),
        batch: async () => [],
      },
      ASSETS: {
        fetch: async () => new Response("asset"),
      },
    },
    passwords,
  };
}

describe("General User Login Security: Prevention of Admin Login Bypass", () => {
  beforeEach(() => {
    clearAuth();
    vi.restoreAllMocks();
  });

  describe("1. Worker API: POST /api/auth/verify user-only enforcement", () => {
    it("rejects admin password with 403 Forbidden when userOnly is true", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          userOnly: true,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(false);
      expect(data.error).toContain("管理者としてログインするには「管理者ログイン」から秘密の暗号およびTurnstile認証を行ってください");
    });

    it("rejects admin password with 403 Forbidden when role: user is specified", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          role: "user",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(false);
      expect(data.error).toContain("管理者ログイン");
    });

    it("rejects admin password with 403 Forbidden when x-auth-mode: user header is sent", async () => {
      const { env } = createMockEnv();
      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-mode": "user",
        },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(false);
      expect(data.error).toContain("管理者ログイン");
    });

    it("authenticates legitimate general user password under user-only flow", async () => {
      const { env, passwords } = createMockEnv();
      passwords.set("usr-1", {
        id: "usr-1",
        name: "一般テストユーザー",
        password_hash: await hashPassword(TEST_USER_PASSWORD),
        role: "user",
        max_stocks: 20,
        max_indices: 5,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const req = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-mode": "user",
        },
        body: JSON.stringify({
          password: TEST_USER_PASSWORD,
          userOnly: true,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(true);
      expect(data.role).toBe("user");
      expect(data.name).toBe("一般テストユーザー");
    });
  });

  describe("2. Client-side Auth Library: verifyPassword defensive guard", () => {
    function setupMockBrowserStorage() {
      const sessionMap = new Map<string, string>();
      const localMap = new Map<string, string>();
      const sessionStorageObj = {
        getItem: (k: string) => sessionMap.get(k) ?? null,
        setItem: (k: string, v: string) => sessionMap.set(k, v),
        removeItem: (k: string) => sessionMap.delete(k),
        clear: () => sessionMap.clear(),
      };
      const localStorageObj = {
        getItem: (k: string) => localMap.get(k) ?? null,
        setItem: (k: string, v: string) => localMap.set(k, v),
        removeItem: (k: string) => localMap.delete(k),
        clear: () => localMap.clear(),
      };
      vi.stubGlobal("sessionStorage", sessionStorageObj);
      vi.stubGlobal("localStorage", localStorageObj);
      return { sessionMap, localMap };
    }

    it("rejects when the server returns an admin role in verifyPassword and prevents session storage", async () => {
      const { sessionMap } = setupMockBrowserStorage();
      // Mock fetch simulating an older API or misconfigured endpoint returning admin
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          role: "admin",
          name: "マスター管理者",
        }),
      } as any);

      const result = await verifyPassword(TEST_ADMIN_PASSWORD);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("管理者としてログインするには「管理者ログイン」から秘密の暗号およびTurnstile認証を行ってください");
      expect(result.session).toBeUndefined();

      // Ensure no auth session is persisted
      expect(sessionMap.size).toBe(0);
      expect(getStoredAuth()).toBeNull();
    });

    it("stores and returns general user session when verified as user", async () => {
      setupMockBrowserStorage();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          role: "user",
          name: "一般ユーザー",
          maxStocks: 15,
          maxIndices: 3,
          id: "pwd-1234",
        }),
      } as any);

      const result = await verifyPassword(TEST_USER_PASSWORD);
      expect(result.ok).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.role).toBe("user");
      expect(result.session?.name).toBe("一般ユーザー");

      const stored = getStoredAuth();
      expect(stored).toBeDefined();
      expect(stored?.role).toBe("user");
    });
  });

  describe("3. UI Component Contract: AuthModal & PortfolioManagerPage", () => {
    const authModalCode = readFileSync(resolve(process.cwd(), "src/components/AuthModal.tsx"), "utf-8");
    const portfolioCode = readFileSync(
      resolve(process.cwd(), "src/components/PortfolioManagerPage.tsx"),
      "utf-8",
    );

    it("AuthModal does not prompt users to enter admin passwords in general user mode", () => {
      expect(authModalCode).not.toContain("ユーザーパスワードまたは管理者パスワード");
      expect(authModalCode).toContain('placeholder={authMode === "admin" ? "管理者パスワード" : "ユーザー用アクセスパスワード"}');
      expect(authModalCode).toContain("管理者が発行したユーザーパスワード");
      expect(authModalCode).toContain("管理者の方は「管理者ログイン」タブをご利用ください");
    });

    it("PortfolioManagerPage does not prompt users to enter admin passwords in general user mode", () => {
      expect(portfolioCode).not.toContain("ユーザーまたは管理者パスワード");
      expect(portfolioCode).toContain('placeholder={authMode === "admin" ? "管理者パスワード" : "ユーザー用アクセスパスワード"}');
      expect(portfolioCode).toContain("管理者が発行したユーザーパスワード");
      expect(portfolioCode).toContain("管理者の方は「管理者ログイン」タブをご利用ください");
    });
  });
});
