import { describe, it, expect, beforeEach } from "vitest";
import { getPasswordStrength } from "../components/AdminDashboard";
import worker from "../../worker/internal-impl";
import { clearAuthCache, resetPasswordTableEnsured, hashPassword } from "../../worker/internal";

describe("Admin Security & Enhanced Features", () => {
  beforeEach(() => {
    clearAuthCache();
    resetPasswordTableEnsured();
  });

  const createMockDb = (masterPasswordHash: string) => {
    return {
      prepare: (sql: string) => {
        const stmt = {
          bind: () => stmt,
          all: async () => {
            if (sql.includes("FROM access_passwords WHERE id = 'admin-master'")) {
              return {
                results: [
                  {
                    id: "admin-master",
                    name: "マスター管理者",
                    role: "admin",
                    is_active: 1,
                    password_hash: masterPasswordHash,
                  },
                ],
              };
            }
            if (sql.includes("COUNT(*) as count FROM access_passwords")) {
              return {
                results: [
                  { role: "admin", is_active: 1, count: 1 },
                  { role: "user", is_active: 1, count: 4 },
                ],
              };
            }
            if (sql.includes("COUNT(*) as count FROM indices")) {
              return { results: [{ count: 3 }] };
            }
            if (sql.includes("COUNT(*) as count FROM basket_items")) {
              return { results: [{ count: 18 }] };
            }
            return { results: [] };
          },
          run: async () => ({ success: true }),
          first: async () => null,
        };
        return stmt;
      },
    };
  };

  describe("Password Strength Meter", () => {
    it("evaluates passwords accurately across all complexity levels", () => {
      // Empty
      const empty = getPasswordStrength("");
      expect(empty.score).toBe(0);
      expect(empty.label).toBe("未入力");

      // Weak: short simple letters
      const weak = getPasswordStrength("abc");
      expect(weak.score).toBe(1);
      expect(weak.label).toContain("脆弱");

      // Fair: 8 chars lowercase/numbers
      const fair = getPasswordStrength("abcdef89");
      expect(fair.score).toBe(2);
      expect(fair.label).toContain("普通");

      // Good: 8+ chars mixed case + numbers
      const good = getPasswordStrength("Abcdef123");
      expect(good.score).toBe(3);
      expect(good.label).toContain("良好");

      // Strong: 12+ chars uppercase, lowercase, numbers, symbols
      const strong = getPasswordStrength("P@ssw0rd!Secure2026");
      expect(strong.score).toBe(5);
      expect(strong.label).toContain("強固");
    });
  });

  describe("Admin Telemetry Endpoint (GET /api/admin/system-stats)", () => {
    it("rejects unauthenticated requests with 403 Forbidden", async () => {
      const req = new Request("http://localhost/api/admin/system-stats", {
        method: "GET",
      });
      const env = {
        DB: createMockDb("dummy-hash"),
        ADMIN_PASSWORD: "admin-secret-password-123",
      };

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
    });

    it("returns system statistics when authenticated with valid admin credentials", async () => {
      const masterHash = await hashPassword("admin-secret-password-123");
      const req = new Request("http://localhost/api/admin/system-stats", {
        method: "GET",
        headers: {
          "x-auth-password": "admin-secret-password-123",
        },
      });
      const env = {
        DB: createMockDb(masterHash),
        ADMIN_PASSWORD: "admin-secret-password-123",
      };

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.stats).toBeDefined();
      expect(json.stats.dbStatus).toBe("CONNECTED");
      expect(json.stats.indicesCount).toBeDefined();
      expect(json.stats.totalConstituents).toBeDefined();
      expect(json.stats.cacheStats).toBeDefined();
      expect(json.stats.cacheStats.hitRatio).toBeDefined();
      expect(json.stats.version).toContain("2.4.0");
      expect(json.stats.serverTime).toBeDefined();
    });
  });

  describe("Admin Password Change Defense-in-Depth (PUT /api/admin/admin-password)", () => {
    it("successfully changes password when currentPassword is correct", async () => {
      const masterHash = await hashPassword("current-admin-secret-123");
      const env = {
        DB: createMockDb(masterHash),
        ADMIN_PASSWORD: "current-admin-secret-123",
      };

      const req = new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "current-admin-secret-123",
        },
        body: JSON.stringify({
          currentPassword: "current-admin-secret-123",
          newPassword: "BrandNewSecurePassword456!",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    it("rejects password update when currentPassword does not match active password", async () => {
      const masterHash = await hashPassword("current-admin-secret-123");
      const env = {
        DB: createMockDb(masterHash),
        ADMIN_PASSWORD: "current-admin-secret-123",
      };

      const req = new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "current-admin-secret-123",
        },
        body: JSON.stringify({
          currentPassword: "wrong-current-password",
          newPassword: "BrandNewSecurePassword456!",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain("現在の管理者パスワードが正しくありません");
    });
  });
});
