import { beforeEach, describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  hashPassword,
  ADMIN_LOGIN_LOCKOUT_SECONDS,
  TURNSTILE_DEFAULT_SECRET_KEY,
  DEFAULT_DEV_ADMIN_SECRET_CODE,
  verifyTurnstileToken,
  verifyAdminSecretCode,
  checkAdminLoginLockout,
  recordAdminLoginFailure,
  resetAdminLoginAttempts,
} from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";
const TEST_SECRET_CODE = "custom-admin-secret-999";

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

function createTestEnv() {
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
      const ip = params[0] as string;
      const count = params[1] as number;
      const lastFailed = params[2] as number;
      const lockedUntil = params[3] as number;
      attempts.set(ip, {
        ip,
        failed_count: count,
        last_failed_at: lastFailed,
        locked_until: lockedUntil,
      });
      return { meta: { changes: 1 } };
    }
    if (query.includes("DELETE FROM admin_login_attempts WHERE ip = ?")) {
      const ip = params[0] as string;
      attempts.delete(ip);
      return { meta: { changes: 1 } };
    }
    if (query.includes("UPDATE access_passwords SET secret_code_hash = ?")) {
      const hash = params[0] as string;
      const updated = params[1] as number;
      const master = passwords.get("admin-master");
      if (master) {
        master.secret_code_hash = hash;
        master.updated_at = updated;
      }
      return { meta: { changes: 1 } };
    }
    if (query.includes("INSERT INTO access_passwords")) {
      if (query.includes("'admin-master'")) {
        const pwdHash = params[0] as string;
        const secretHash = params[1] as string;
        const created = params[2] as number;
        passwords.set("admin-master", {
          id: "admin-master",
          name: "マスター管理者",
          password_hash: pwdHash,
          secret_code_hash: secretHash,
          role: "admin",
          max_stocks: null,
          max_indices: null,
          is_active: 1,
          created_at: created,
          updated_at: created,
        });
      }
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  };

  const mockDb = {
    prepare: vi.fn().mockImplementation((query: string) => {
      return {
        bind: (...params: unknown[]) => ({
          all: () => executeAll(query, params),
          run: () => executeRun(query, params),
        }),
        run: () => executeRun(query, []),
        all: () => executeAll(query, []),
      };
    }),
  };

  const env = {
    DB: mockDb,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ADMIN_SECRET_CODE: TEST_SECRET_CODE,
    TURNSTILE_SITE_KEY: "test-site-key-abc",
    TURNSTILE_SECRET_KEY: TURNSTILE_DEFAULT_SECRET_KEY,
    ASSETS: {
      fetch: async () =>
        new Response("<!doctype html><html><body>OK</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    },
  };

  return { env, attempts, passwords };
}

describe("Admin Login Security: Turnstile, Rate Limiting, and Secret Code", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  describe("Turnstile Token Verification", () => {
    it("rejects missing or empty Turnstile token", async () => {
      const res1 = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, "");
      expect(res1.success).toBe(false);

      const res2 = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, "   ");
      expect(res2.success).toBe(false);
    });

    it("accepts valid test token using official test secret", async () => {
      const res = await verifyTurnstileToken(TURNSTILE_DEFAULT_SECRET_KEY, "dummy-turnstile-token");
      expect(res.success).toBe(true);
    });
  });

  describe("Admin Secret Code Verification", () => {
    it("rejects empty secret code", async () => {
      const { env } = createTestEnv();
      expect(await verifyAdminSecretCode(env as any, "")).toBe(false);
      expect(await verifyAdminSecretCode(env as any, "   ")).toBe(false);
    });

    it("verifies correctly against env.ADMIN_SECRET_CODE", async () => {
      const { env } = createTestEnv();
      expect(await verifyAdminSecretCode(env as any, TEST_SECRET_CODE)).toBe(true);
      expect(await verifyAdminSecretCode(env as any, "wrong-secret-code")).toBe(false);
    });

    it("falls back to default dev code when env is not set", async () => {
      const { env } = createTestEnv();
      delete (env as any).ADMIN_SECRET_CODE;
      expect(await verifyAdminSecretCode(env as any, DEFAULT_DEV_ADMIN_SECRET_CODE)).toBe(true);
      expect(await verifyAdminSecretCode(env as any, "wrong-code")).toBe(false);
    });

    it("verifies against D1 secret_code_hash when customized", async () => {
      const { env, passwords } = createTestEnv();
      const customHash = await hashPassword("super-secure-secret-2026");
      passwords.set("admin-master", {
        id: "admin-master",
        name: "マスター管理者",
        password_hash: await hashPassword(TEST_ADMIN_PASSWORD),
        secret_code_hash: customHash,
        role: "admin",
        max_stocks: null,
        max_indices: null,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      expect(await verifyAdminSecretCode(env as any, "super-secure-secret-2026")).toBe(true);
      expect(await verifyAdminSecretCode(env as any, TEST_SECRET_CODE)).toBe(false);
    });
  });

  describe("Admin Login Lockout & Attempt Counting", () => {
    it("tracks failed attempts and enforces lockout after 5 consecutive failures", async () => {
      const { env } = createTestEnv();
      const ip = "192.168.1.100";

      // Initial state: not locked, 5 attempts remaining
      const init = await checkAdminLoginLockout(env as any, ip);
      expect(init.locked).toBe(false);
      expect(init.remainingAttempts).toBe(5);

      // Attempt 1 fails
      const f1 = await recordAdminLoginFailure(env as any, ip);
      expect(f1.locked).toBe(false);
      expect(f1.failedCount).toBe(1);
      expect(f1.remainingAttempts).toBe(4);

      // Attempt 2 fails
      const f2 = await recordAdminLoginFailure(env as any, ip);
      expect(f2.locked).toBe(false);
      expect(f2.failedCount).toBe(2);
      expect(f2.remainingAttempts).toBe(3);

      // Attempt 3 fails
      const f3 = await recordAdminLoginFailure(env as any, ip);
      expect(f3.locked).toBe(false);
      expect(f3.failedCount).toBe(3);
      expect(f3.remainingAttempts).toBe(2);

      // Attempt 4 fails
      const f4 = await recordAdminLoginFailure(env as any, ip);
      expect(f4.locked).toBe(false);
      expect(f4.failedCount).toBe(4);
      expect(f4.remainingAttempts).toBe(1);

      // Attempt 5 fails -> triggers 15-minute lockout
      const f5 = await recordAdminLoginFailure(env as any, ip);
      expect(f5.locked).toBe(true);
      expect(f5.failedCount).toBe(5);
      expect(f5.remainingAttempts).toBe(0);
      expect(f5.remainingSeconds).toBe(ADMIN_LOGIN_LOCKOUT_SECONDS);

      // Subsequent check confirms lockout
      const check = await checkAdminLoginLockout(env as any, ip);
      expect(check.locked).toBe(true);
      expect(check.remainingAttempts).toBe(0);
      expect(check.remainingSeconds).toBeGreaterThan(0);

      // Successful reset clears lockout
      await resetAdminLoginAttempts(env as any, ip);
      const afterReset = await checkAdminLoginLockout(env as any, ip);
      expect(afterReset.locked).toBe(false);
      expect(afterReset.remainingAttempts).toBe(5);
    });
  });

  describe("API Endpoint: GET /api/auth/turnstile-config", () => {
    it("returns configured site key and lockout status", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/turnstile-config");
      const res = await worker.fetch(req, env as any);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.siteKey).toBe("test-site-key-abc");
      expect(data.lockout.locked).toBe(false);
      expect(data.lockout.remainingAttempts).toBe(5);
    });
  });

  describe("API Endpoint: POST /api/auth/admin-login", () => {
    it("authenticates successfully with valid password, secret code, and Turnstile token", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.role).toBe("admin");
      expect(data.id).toBe("admin-master");
    });

    it("rejects missing Turnstile token with 400 Bad Request", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("Turnstile認証");
    });

    it("rejects missing secret code with 400 Bad Request", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: "",
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("秘密の暗号を入力してください");
    });

    it("rejects incorrect secret code with 401 and tracks remaining attempts", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: "wrong-secret",
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("秘密の暗号が正しくありません");
      expect(data.remainingAttempts).toBe(4);
    });

    it("rejects incorrect admin password with 401 and tracks remaining attempts", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "wrong-admin-password",
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("管理者パスワードが正しくありません");
      expect(data.remainingAttempts).toBe(4);
    });

    it("locks out user on 5th consecutive failure with 429 Too Many Requests", async () => {
      const { env } = createTestEnv();

      // Trigger 4 failed attempts
      for (let i = 0; i < 4; i++) {
        const req = new Request("http://localhost/api/auth/admin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: TEST_ADMIN_PASSWORD,
            secretCode: "wrong-secret",
            turnstileToken: "dummy-turnstile-token",
          }),
        });
        const res = await worker.fetch(req, env as any);
        expect(res.status).toBe(401);
      }

      // 5th failed attempt -> 429 Locked out
      const req5 = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: "wrong-secret",
          turnstileToken: "dummy-turnstile-token",
        }),
      });
      const res5 = await worker.fetch(req5, env as any);
      expect(res5.status).toBe(429);
      const data5 = await res5.json();
      expect(data5.ok).toBe(false);
      expect(data5.locked).toBe(true);
      expect(data5.error).toContain("ロック");

      // 6th attempt (even with valid credentials) is blocked by lockout
      const req6 = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });
      const res6 = await worker.fetch(req6, env as any);
      expect(res6.status).toBe(429);
      const data6 = await res6.json();
      expect(data6.locked).toBe(true);
    });
  });

  describe("API Endpoint: PUT /api/admin/admin-secret-code", () => {
    it("updates secret code and verifies with new secret code afterwards", async () => {
      const { env } = createTestEnv();

      // 1. Update secret code using master admin credentials
      const updateReq = new Request("http://localhost/api/admin/admin-secret-code", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          currentSecretCode: TEST_SECRET_CODE,
          newSecretCode: "brand-new-secret-2026",
        }),
      });

      const updateRes = await worker.fetch(updateReq, env as any);
      expect(updateRes.status).toBe(200);
      const updateData = await updateRes.json();
      expect(updateData.ok).toBe(true);

      // 2. Old secret code now fails
      const oldLoginReq = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: TEST_SECRET_CODE,
          turnstileToken: "dummy-turnstile-token",
        }),
      });
      const oldLoginRes = await worker.fetch(oldLoginReq, env as any);
      expect(oldLoginRes.status).toBe(401);

      // 3. New secret code succeeds
      const newLoginReq = new Request("http://localhost/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: TEST_ADMIN_PASSWORD,
          secretCode: "brand-new-secret-2026",
          turnstileToken: "dummy-turnstile-token",
        }),
      });
      const newLoginRes = await worker.fetch(newLoginReq, env as any);
      expect(newLoginRes.status).toBe(200);
      const newLoginData = await newLoginRes.json();
      expect(newLoginData.ok).toBe(true);
      expect(newLoginData.role).toBe("admin");
    });
  });

  describe("Content Security Policy (CSP)", () => {
    it("includes https://challenges.cloudflare.com in script-src, frame-src, and connect-src", async () => {
      const { env } = createTestEnv();
      const req = new Request("http://localhost/");
      const res = await worker.fetch(req, env as any);

      const csp = res.headers.get("Content-Security-Policy") || "";
      expect(csp).toContain("script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://*.tradingview.com https://challenges.cloudflare.com");
      expect(csp).toContain("frame-src 'self' https://www.tradingview-widget.com https://s.tradingview.com https://*.tradingview.com https://challenges.cloudflare.com");
      expect(csp).toContain("connect-src 'self' https://*.tradingview.com https://*.tradingview-widget.com wss://*.tradingview.com https://challenges.cloudflare.com");
    });
  });
});
