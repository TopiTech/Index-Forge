import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../worker/index";
import {
  setAllowMemoryCacheInTest,
  setMemoryCache,
  clearMemoryCache,
  getMemoryCacheEntry,
  hashPassword,
} from "../../worker/internal";

function createTestDb(passwords: Map<string, any>) {
  const executeQuery = (query: string, params: unknown[] = []) => ({
    all: async () => {
      if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
        const master = passwords.get("admin-master");
        return { results: master ? [master] : [] };
      }
      if (query.includes("FROM access_passwords WHERE id = ?")) {
        const targetId = params[0] as string;
        const record = passwords.get(targetId);
        return { results: record ? [record] : [] };
      }
      if (query.includes("FROM access_passwords WHERE id != ? AND id != 'admin-master'")) {
        const excludeId = params[0] as string;
        const matches = Array.from(passwords.values()).filter(
          (p) => p.id !== excludeId && p.id !== "admin-master",
        );
        return { results: matches };
      }
      if (query.includes("FROM access_passwords WHERE id != 'admin-master'")) {
        const matches = Array.from(passwords.values()).filter(
          (p) => p.id !== "admin-master",
        );
        return { results: matches };
      }
      if (query.includes("FROM access_passwords")) {
        return { results: Array.from(passwords.values()) };
      }
      return { results: [] };
    },
    run: async () => {
      if (query.includes("UPDATE access_passwords")) {
        const targetId = params[params.length - 1] as string;
        const record = passwords.get(targetId);
        if (record && query.includes("password_hash = ?")) {
          record.password_hash = params[0];
        }
      }
      return { success: true, meta: { changes: 1 } };
    },
  });

  return {
    prepare: vi.fn().mockImplementation((query: string) => ({
      ...executeQuery(query),
      bind: vi.fn().mockImplementation((...params: unknown[]) => executeQuery(query, params)),
    })),
    batch: vi.fn().mockResolvedValue([{ success: true }]),
  };
}

describe("Goal Comprehensive Code Review Verification", () => {
  beforeEach(() => {
    setAllowMemoryCacheInTest(true);
    clearMemoryCache();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    clearMemoryCache();
    vi.restoreAllMocks();
  });

  describe("P1 Security: Admin Password Collision Check Bypass Prevention", () => {
    it("rejects password update on secondary admin when 'role' is omitted in payload and password collides with a standard user", async () => {
      const userHash = await hashPassword("user-secret-1234");
      const adminHash = await hashPassword("admin-secret-9999");
      const masterHash = await hashPassword("master-root-pwd");

      const passwords = new Map<string, any>([
        [
          "admin-master",
          {
            id: "admin-master",
            name: "マスター管理者",
            password_hash: masterHash,
            role: "admin",
            is_active: 1,
            created_at: 1000,
          },
        ],
        [
          "admin-secondary",
          {
            id: "admin-secondary",
            name: "副管理者",
            password_hash: adminHash,
            role: "admin",
            is_active: 1,
            created_at: 2000,
          },
        ],
        [
          "user-1",
          {
            id: "user-1",
            name: "一般ユーザー",
            password_hash: userHash,
            role: "user",
            is_active: 1,
            created_at: 3000,
          },
        ],
      ]);

      const mockDb = createTestDb(passwords);

      const env: any = {
        DB: mockDb,
        ADMIN_PASSWORD: "master-root-pwd",
      };

      // Authenticated admin request attempting to change admin-secondary's password
      // to user-secret-1234 WITHOUT supplying role in the body
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer master-root-pwd",
        },
        body: JSON.stringify({
          id: "admin-secondary",
          password: "user-secret-1234",
          // role is intentionally omitted (mimicking standard modal or third-party client)
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("既存のユーザーアカウントで使用されているパスワードは管理者に設定できません");
    });

    it("allows standard user password update without role to collide with another user", async () => {
      const user1Hash = await hashPassword("user-secret-1234");
      const user2Hash = await hashPassword("other-user-pwd");
      const masterHash = await hashPassword("master-root-pwd");

      const passwords = new Map<string, any>([
        [
          "admin-master",
          {
            id: "admin-master",
            name: "マスター管理者",
            password_hash: masterHash,
            role: "admin",
            is_active: 1,
            created_at: 1000,
          },
        ],
        [
          "user-1",
          {
            id: "user-1",
            name: "一般ユーザー1",
            password_hash: user1Hash,
            role: "user",
            is_active: 1,
            created_at: 2000,
          },
        ],
        [
          "user-2",
          {
            id: "user-2",
            name: "一般ユーザー2",
            password_hash: user2Hash,
            role: "user",
            is_active: 1,
            created_at: 3000,
          },
        ],
      ]);

      const mockDb = createTestDb(passwords);

      const env: any = {
        DB: mockDb,
        ADMIN_PASSWORD: "master-root-pwd",
      };

      // Updating user-2 to have the same password as user-1 without passing role
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer master-root-pwd",
        },
        body: JSON.stringify({
          id: "user-2",
          password: "user-secret-1234",
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe("P2 Performance & Cache: Memory Cache Dynamic TTL Preservation", () => {
    it("getMemoryCacheEntry returns accurate remainingSeconds and expires as expected", () => {
      setMemoryCache("test:key", { value: 123 }, 25);
      const entry = getMemoryCacheEntry<{ value: number }>("test:key");
      expect(entry).not.toBeNull();
      expect(entry!.data.value).toBe(123);
      expect(entry!.remainingSeconds).toBeGreaterThanOrEqual(24);
      expect(entry!.remainingSeconds).toBeLessThanOrEqual(25);
    });

    it("GET /api/snapshot memory cache hit sets dynamic max-age and s-maxage reflecting remaining TTL", async () => {
      const cachedSnapshot = {
        symbol: "^N225",
        name: "日経平均株価",
        currentPrice: 39000,
        change: 150,
        changePercent: 0.38,
        previousClose: 38850,
        high: 39100,
        low: 38700,
        open: 38800,
        timestamp: new Date().toISOString(),
        series: [{ date: "2026-09-29", close: 39000 }],
      };

      // Set snapshot memory cache with 25s remaining TTL
      setMemoryCache("snapshot:^N225", cachedSnapshot, 25);

      const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
      };

      const env: any = {
        DB: mockDb,
      };

      const req = new Request("http://localhost/api/snapshot?symbol=^N225", {
        method: "GET",
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get("cache-control");
      expect(cacheControl).toBeDefined();
      // Previously hardcoded to s-maxage=300; now must be capped to remaining seconds (<= 25)
      expect(cacheControl).not.toContain("s-maxage=300");
      expect(cacheControl).toMatch(/s-maxage=2[0-5]/);
    });

    it("GET /api/ticker-prices memory cache hit respects allStale and caps s-maxage <= 10", async () => {
      const staleData = {
        updatedAt: new Date().toISOString(),
        quotes: [
          {
            proName: "INDEX:NKY",
            symbol: "^N225",
            price: 38980.5,
            change: 145.2,
            changePercent: 0.37,
            formattedPrice: "38,980.50",
            formattedChange: "+145.20",
            formattedChangePercent: "+0.37%",
            isPositive: true,
            stale: true,
          },
        ],
        allStale: true,
      };

      setMemoryCache("ticker:quotes", staleData, 8);

      const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({ success: true }),
        })),
      };

      const env: any = {
        DB: mockDb,
      };

      const req = new Request("http://localhost/api/ticker-prices", {
        method: "GET",
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      const cacheControl = res.headers.get("cache-control");
      expect(cacheControl).toBeDefined();
      // Must not be s-maxage=60; stale quotes should cap edge caching to <= 10s
      expect(cacheControl).not.toContain("s-maxage=60");
      expect(cacheControl).toMatch(/s-maxage=[0-9]/);
    });
  });
});
