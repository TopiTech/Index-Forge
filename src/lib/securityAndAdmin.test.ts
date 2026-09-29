import { beforeEach, describe, it, expect, vi } from "vitest";
import worker, {
  hashPassword,
  hashToken,
  timingSafeEqual,
  verifyPasswordHash,
  SYSTEM_INDICES,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  plain_password: string | null;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function createSecurityTestEnv() {
  const passwords = new Map<string, PasswordRecord>();
  const indices = new Map<
    string,
    {
      id: string;
      name: string;
      description: string;
      base_value: number;
      owner_token_hash: string | null;
      creator_id?: string | null;
    }
  >();
  const basketItems: Array<{
    index_id: string;
    ticker: string;
    name: string;
    weight: number;
    theme: string;
  }> = [];

  // Seed default system indices
  for (const sysId of Array.from(SYSTEM_INDICES)) {
    indices.set(sysId, {
      id: sysId,
      name: `System Index ${sysId}`,
      description: "Built-in system index",
      base_value: 1000,
      owner_token_hash: null,
    });
  }

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: (...params: unknown[]) => ({
        all: async () => {
          if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            const master = passwords.get("admin-master");
            return { results: master ? [master] : [] };
          }
          if (
            query.includes("FROM access_passwords") &&
            query.includes("id != 'admin-master'") &&
            query.includes("password_hash")
          ) {
            const matches = Array.from(passwords.values()).filter(
              (p) => p.is_active === 1 && p.id !== "admin-master",
            );
            return { results: matches };
          }
          if (
            query.includes(
              "FROM access_passwords WHERE password_hash = ? AND is_active = 1 AND id != 'admin-master'",
            )
          ) {
            const hash = params[0] as string;
            const matches = Array.from(passwords.values()).filter(
              (p) => p.password_hash === hash && p.is_active === 1 && p.id !== "admin-master",
            );
            return { results: matches };
          }
          if (query.includes("FROM access_passwords WHERE password_hash = ? AND is_active = 1")) {
            const hash = params[0] as string;
            const matches = Array.from(passwords.values()).filter(
              (p) => p.password_hash === hash && p.is_active === 1,
            );
            return { results: matches };
          }
          if (query.includes("FROM access_passwords WHERE id != 'admin-master'")) {
            const matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
            return { results: matches.map(({ plain_password: _plainPassword, ...row }) => row) };
          }
          if (query.includes("FROM access_passwords WHERE id = ?")) {
            const targetId = params[0] as string;
            const p = passwords.get(targetId);
            return { results: p ? [p] : [] };
          }
          if (query.includes("COUNT(*) as count FROM indices WHERE creator_id = ?")) {
            const creatorId = params[0] as string;
            const count = Array.from(indices.values()).filter(
              (idx: any) => idx.creator_id === creatorId,
            ).length;
            return { results: [{ count }] };
          }
          if (query.includes("FROM indices WHERE id = ?")) {
            const id = params[0] as string;
            const idx = indices.get(id);
            return { results: idx ? [idx] : [] };
          }
          if (query.includes("FROM basket_items")) {
            const indexId = params[0] as string;
            const items = basketItems.filter((b) => b.index_id === indexId);
            if (query.includes("count(*)")) {
              return { results: [{ cnt: items.length }] };
            }
            return { results: items };
          }
          if (query.includes("FROM rate_limits")) {
            return { results: [] };
          }
          return { results: [] };
        },
        run: async () => {
          if (
            query.includes("INSERT INTO access_passwords") ||
            query.includes("INSERT OR REPLACE INTO access_passwords")
          ) {
            if (query.includes("'admin-master'")) {
              // Master admin update: VALUES ('admin-master', 'マスター管理者', ?, 'admin', NULL, 1, ?, ?)
              const hash = params[0] as string;
              const now = params[1] as number;
              passwords.set("admin-master", {
                id: "admin-master",
                name: "マスター管理者",
                password_hash: hash,
                plain_password: null,
                role: "admin",
                max_stocks: null,
                max_indices: null,
                is_active: 1,
                created_at: now,
                updated_at: now,
              });
            } else {
              // User password create
              const id = params[0] as string;
              const name = params[1] as string;
              const hash = params[2] as string;
              const role = params[3] as "admin" | "user";
              const maxStocks = params[4] as number | null;
              let maxIndices: number | null = null;
              let now1: number;
              let now2: number;
              if (params.length >= 8) {
                maxIndices = params[5] as number | null;
                now1 = params[6] as number;
                now2 = params[7] as number;
              } else {
                now1 = params[5] as number;
                now2 = params[6] as number;
              }
              passwords.set(id, {
                id,
                name,
                password_hash: hash,
                plain_password: null,
                role,
                max_stocks: maxStocks,
                max_indices: maxIndices,
                is_active: 1,
                created_at: now1,
                updated_at: now2,
              });
            }
            return { success: true };
          }
          if (query.includes("UPDATE access_passwords")) {
            // Find target id which is the last parameter
            const targetId = params[params.length - 1] as string;
            const existing = passwords.get(targetId);
            if (existing) {
              if (query.includes("password_hash = ?")) {
                existing.password_hash = params[0] as string;
                existing.updated_at = params[1] as number;
              }
              if (query.includes("role = ?")) {
                existing.role = params[0] as "admin" | "user";
              }
              if (query.includes("is_active = ?")) {
                existing.is_active = params[0] as number;
              }
              if (query.includes("max_stocks = ?")) {
                existing.max_stocks = params[0] as number | null;
              }
              if (query.includes("max_indices = ?")) {
                existing.max_indices = params[0] as number | null;
              }
            }
            return { success: true };
          }
          if (query.includes("DELETE FROM access_passwords WHERE id = ?")) {
            const id = params[0] as string;
            passwords.delete(id);
            return { success: true };
          }
          if (
            query.includes("INSERT OR REPLACE INTO basket_items") ||
            query.includes("INSERT INTO basket_items")
          ) {
            const [indexId, ticker, name, weight, theme] = params as [
              string,
              string,
              string,
              number,
              string,
            ];
            const existingIdx = basketItems.findIndex(
              (b) => b.index_id === indexId && b.ticker === ticker,
            );
            if (existingIdx >= 0) {
              basketItems[existingIdx] = { index_id: indexId, ticker, name, weight, theme };
            } else {
              basketItems.push({ index_id: indexId, ticker, name, weight, theme });
            }
            return { success: true };
          }
          if (query.includes("DELETE FROM basket_items")) {
            const [indexId] = params as [string];
            for (let i = basketItems.length - 1; i >= 0; i--) {
              if (basketItems[i].index_id === indexId) basketItems.splice(i, 1);
            }
            return { success: true };
          }
          if (query.includes("INTO indices")) {
            const [id, name, description, baseValue, hash] = params as [
              string,
              string,
              string,
              number,
              string | null,
            ];
            const creatorId = params.length >= 7 ? (params[6] as string | null) : null;
            indices.set(id, {
              id,
              name,
              description,
              base_value: baseValue,
              owner_token_hash: hash || null,
              creator_id: creatorId,
            });
            return { success: true };
          }
          if (query.includes("DELETE FROM indices WHERE id = ?")) {
            const id = params[0] as string;
            indices.delete(id);
            return { success: true };
          }
          return { success: true };
        },
      }),
      all: async () => {
        if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
          const master = passwords.get("admin-master");
          return { results: master ? [master] : [] };
        }
        if (query.includes("FROM access_passwords WHERE id != 'admin-master'")) {
          const matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
          return { results: matches.map(({ plain_password: _plainPassword, ...row }) => row) };
        }
        if (query.includes("FROM access_passwords")) {
          return { results: Array.from(passwords.values()) };
        }
        return { results: [] };
      },
      run: async () => ({ success: true }),
    };
  });

  return {
    env: {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
      },
      DB: {
        prepare,
        batch: vi.fn().mockImplementation(async (stmts: any[]) => {
          for (const s of stmts) {
            if (typeof s?.run === "function") await s.run();
          }
          return [];
        }),
      },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    },
    passwords,
    indices,
    basketItems,
  };
}

describe("Security and Admin Regression Tests", () => {
  it("authenticates with the deployment admin secret when no customized password exists", async () => {
    const { env } = createSecurityTestEnv();
    const req = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.role).toBe("admin");
  });

  it("uses salted PBKDF2 hashes and only returns an issued password once", async () => {
    const { env, passwords } = createSecurityTestEnv();
    const req = new Request("http://localhost/api/admin/passwords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        name: "Issued User",
        password: "issued-password-123",
        maxStocks: 5,
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(201);
    const data = await res.json();
    // SECURITY: The API response must never carry the plaintext password.
    // The client already holds the value it generated before sending it.
    expect(data.password.initialPassword).toBeUndefined();
    expect(data.password.plain_password).toBeUndefined();

    const stored = Array.from(passwords.values()).find((record) => record.name === "Issued User");
    expect(stored?.plain_password).toBeNull();
    expect(stored?.password_hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPasswordHash("issued-password-123", stored!.password_hash)).toBe(true);
    expect(await verifyPasswordHash("wrong-password", stored!.password_hash)).toBe(false);

    const otherHash = await hashPassword("issued-password-123");
    expect(otherHash).not.toBe(stored!.password_hash);
  });

  it("permanently invalidates default admin password once admin changes the password", async () => {
    const { env, passwords } = createSecurityTestEnv();

    // 1. Admin updates master password to a new strong password
    const changeReq = new Request("http://localhost/api/admin/admin-password", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({ newPassword: "SuperSecretPassword2026!" }),
    });

    const changeRes = await worker.fetch(changeReq, env as any);
    expect(changeRes.status).toBe(200);

    // Verify master admin plain_password is NOT stored in D1
    const masterRecord = passwords.get("admin-master");
    expect(masterRecord).toBeDefined();
    expect(masterRecord?.plain_password).toBeNull();

    // 2. The old built-in password must not authenticate.
    const oldLoginReq = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
    });

    const oldLoginRes = await worker.fetch(oldLoginReq, env as any);
    expect(oldLoginRes.status).toBe(401);
    const oldLoginData = await oldLoginRes.json();
    expect(oldLoginData.ok).toBe(false);

    // 3. Login with NEW password -> MUST SUCCEED (200)
    const newLoginReq = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "SuperSecretPassword2026!" }),
    });

    const newLoginRes = await worker.fetch(newLoginReq, env as any);
    expect(newLoginRes.status).toBe(200);
    const newLoginData = await newLoginRes.json();
    expect(newLoginData.ok).toBe(true);
    expect(newLoginData.role).toBe("admin");
  });

  it("excludes admin-master from GET /api/admin/passwords response to prevent leakage", async () => {
    const { env, passwords } = createSecurityTestEnv();

    // Add admin-master
    const masterHash = await hashToken("SuperSecretPassword2026!");
    passwords.set("admin-master", {
      id: "admin-master",
      name: "マスター管理者",
      password_hash: masterHash,
      plain_password: null,
      role: "admin",
      max_stocks: null,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });

    // Add a normal user
    const userHash = await hashToken("userpass123");
    passwords.set("pwd-user-1", {
      id: "pwd-user-1",
      name: "Test User",
      password_hash: userHash,
      plain_password: "userpass123",
      role: "user",
      max_stocks: 5,
      is_active: 1,
      created_at: 1100,
      updated_at: 1100,
    });

    const req = new Request("http://localhost/api/admin/passwords", {
      method: "GET",
      headers: { "x-auth-password": "SuperSecretPassword2026!" },
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("pwd-user-1");
    expect(list[0].plain_password).toBeUndefined();
    // Ensure admin-master is not present in the returned list
    const hasAdminMaster = list.some((item: any) => item.id === "admin-master");
    expect(hasAdminMaster).toBe(false);
  });

  it("allows admins to update role in PUT /api/admin/passwords", async () => {
    const { env, passwords } = createSecurityTestEnv();

    passwords.set("pwd-user-2", {
      id: "pwd-user-2",
      name: "Promoted User",
      password_hash: await hashToken("promotepass"),
      plain_password: "promotepass",
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });

    const updateReq = new Request("http://localhost/api/admin/passwords", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "pwd-user-2",
        role: "admin",
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(200);
    expect(passwords.get("pwd-user-2")?.role).toBe("admin");
  });

  it("does not allow a secondary admin to rotate the master password", async () => {
    const { env, passwords } = createSecurityTestEnv();
    passwords.set("pwd-secondary-admin", {
      id: "pwd-secondary-admin",
      name: "Secondary Admin",
      password_hash: await hashToken("secondary-password"),
      plain_password: null,
      role: "admin",
      max_stocks: null,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });

    const req = new Request("http://localhost/api/admin/admin-password", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": "secondary-password",
      },
      body: JSON.stringify({ newPassword: "new-master-password" }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(403);
    expect(passwords.has("admin-master")).toBe(false);
  });

  it("allows admins to edit system indices in POST /api/indices", async () => {
    const { env } = createSecurityTestEnv();

    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "nikkei-175",
        name: "日経175 (更新版)",
        description: "管理者によってカスタマイズされた日経175",
        baseValue: 1000,
        basket: [
          { ticker: "7203", name: "トヨタ自動車", weight: 50, theme: "自動車" },
          { ticker: "9984", name: "ソフトバンクグループ", weight: 50, theme: "投資" },
        ],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.id).toBe("nikkei-175");
  });

  it("rejects non-admin users from editing system indices in POST /api/indices", async () => {
    const { env, passwords } = createSecurityTestEnv();

    // Create a regular user
    passwords.set("user-pwd", {
      id: "user-pwd",
      name: "Normal User",
      password_hash: await hashToken("usersecret"),
      plain_password: "usersecret",
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });

    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": "usersecret",
      },
      body: JSON.stringify({
        id: "nikkei-175",
        name: "ハック日経175",
        description: "改ざんの試み",
        baseValue: 1000,
        basket: [{ ticker: "7203", name: "トヨタ", weight: 100, theme: "車" }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("システム指数の編集には管理者権限が必要です");
  });

  describe("Client Auth Session and Headers", () => {
    it("generates correct headers for admin and user sessions", async () => {
      const { getAuthHeaders } = await import("./auth");
      const adminSession = {
        role: "admin" as const,
        name: "管理者",
        password: "pwd1",
        maxStocks: null,
      };
      const userSession = {
        role: "user" as const,
        name: "ユーザー",
        password: "pwd2",
        maxStocks: 5,
      };

      const adminHeaders = getAuthHeaders(adminSession);
      expect(adminHeaders["x-auth-password"]).toBe("pwd1");
      expect(adminHeaders["x-admin-key"]).toBe("pwd1");

      const userHeaders = getAuthHeaders(userSession);
      expect(userHeaders["x-auth-password"]).toBe("pwd2");
      expect(userHeaders["x-admin-key"]).toBeUndefined();
    });

    it("dispatches auth-changed event on storeAuth and clearAuth", async () => {
      const { storeAuth, clearAuth } = await import("./auth");
      let eventFired = 0;
      const originalDispatch = (globalThis as any).dispatchEvent;
      const originalStorage = (globalThis as any).localStorage;
      const originalSessionStorage = (globalThis as any).sessionStorage;
      const mockStorage = new Map<string, string>();
      const mockSessionStorage = new Map<string, string>();

      (globalThis as any).localStorage = {
        getItem: (k: string) => mockStorage.get(k) || null,
        setItem: (k: string, v: string) => mockStorage.set(k, v),
        removeItem: (k: string) => mockStorage.delete(k),
      };
      (globalThis as any).sessionStorage = {
        getItem: (k: string) => mockSessionStorage.get(k) || null,
        setItem: (k: string, v: string) => mockSessionStorage.set(k, v),
        removeItem: (k: string) => mockSessionStorage.delete(k),
      };

      (globalThis as any).dispatchEvent = (evt: Event) => {
        if (evt.type === "auth-changed") {
          eventFired++;
        }
        return true;
      };

      try {
        storeAuth({ role: "admin", name: "管理者", password: "test", maxStocks: null });
        expect(eventFired).toBe(1);
        expect(mockSessionStorage.has("custom_stock_index_auth")).toBe(true);
        expect(mockStorage.has("custom_stock_index_auth")).toBe(false);

        clearAuth();
        expect(eventFired).toBe(2);
        expect(mockSessionStorage.has("custom_stock_index_auth")).toBe(false);
      } finally {
        (globalThis as any).dispatchEvent = originalDispatch;
        (globalThis as any).localStorage = originalStorage;
        (globalThis as any).sessionStorage = originalSessionStorage;
      }
    });
  });

  describe("R1 Regression: IDOR protection on /api/indices/stock", () => {
    it("rejects unauthorized user from adding or removing stocks on another user's custom index", async () => {
      const { env, passwords, indices, basketItems } = createSecurityTestEnv();

      // Setup Owner A with token
      const ownerTokenA = "token-user-a-12345";
      const ownerHashA = await hashToken(ownerTokenA);
      indices.set("custom-a", {
        id: "custom-a",
        name: "User A Index",
        description: "Index by A",
        base_value: 1000,
        owner_token_hash: ownerHashA,
      });
      basketItems.push(
        { index_id: "custom-a", ticker: "7203", name: "Toyota", weight: 50, theme: "Auto" },
        { index_id: "custom-a", ticker: "9984", name: "SBG", weight: 50, theme: "Tech" },
      );

      // Setup User B (an authenticated, valid standard user)
      passwords.set("user-b", {
        id: "user-b",
        name: "User B",
        password_hash: await hashToken("pass-b"),
        plain_password: "pass-b",
        role: "user",
        max_stocks: 10,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      // 1. User B tries to ADD stock without ownerToken -> 403 Forbidden
      const addNoTokenReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "pass-b",
        },
        body: JSON.stringify({
          indexId: "custom-a",
          stock: { ticker: "6758", name: "Sony", weight: 10, theme: "Tech" },
        }),
      });
      const addNoTokenRes = await worker.fetch(addNoTokenReq, env as any);
      expect(addNoTokenRes.status).toBe(403);
      const addNoTokenData = await addNoTokenRes.json();
      expect(addNoTokenData.error).toContain("作成者トークンが必要です");

      // 2. User B tries to ADD stock with WRONG ownerToken -> 403 Forbidden
      const addWrongTokenReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "pass-b",
          "x-owner-token": "wrong-token-xyz",
        },
        body: JSON.stringify({
          indexId: "custom-a",
          stock: { ticker: "6758", name: "Sony", weight: 10, theme: "Tech" },
        }),
      });
      const addWrongTokenRes = await worker.fetch(addWrongTokenReq, env as any);
      expect(addWrongTokenRes.status).toBe(403);
      const addWrongTokenData = await addWrongTokenRes.json();
      expect(addWrongTokenData.error).toContain("作成者トークンが一致しません");

      // 3. User B tries to DELETE stock without ownerToken -> 403 Forbidden
      const delNoTokenReq = new Request(
        "http://localhost/api/indices/stock?indexId=custom-a&ticker=7203",
        {
          method: "DELETE",
          headers: {
            "x-auth-password": "pass-b",
          },
        },
      );
      const delNoTokenRes = await worker.fetch(delNoTokenReq, env as any);
      expect(delNoTokenRes.status).toBe(403);
      const delNoTokenData = await delNoTokenRes.json();
      expect(delNoTokenData.error).toContain("作成者トークンが必要です");

      // 4. User A (or any user providing valid ownerTokenA) -> SUCCESS (200)
      const addValidTokenReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "pass-b",
          "x-owner-token": ownerTokenA,
        },
        body: JSON.stringify({
          indexId: "custom-a",
          stock: { ticker: "6758", name: "Sony", weight: 10, theme: "Tech" },
        }),
      });
      const addValidTokenRes = await worker.fetch(addValidTokenReq, env as any);
      expect(addValidTokenRes.status).toBe(200);

      // 5. Admin can manage stock on custom-a without ownerToken -> SUCCESS (200)
      const adminAddReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "custom-a",
          stock: { ticker: "8035", name: "TEL", weight: 10, theme: "Semi" },
        }),
      });
      const adminAddRes = await worker.fetch(adminAddReq, env as any);
      expect(adminAddRes.status).toBe(200);
    });
  });

  describe("R2 Regression: admin-master protection", () => {
    it("rejects DELETE /api/admin/passwords targeting admin-master with 403", async () => {
      const { env } = createSecurityTestEnv();

      const req = new Request("http://localhost/api/admin/passwords?id=admin-master", {
        method: "DELETE",
        headers: {
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("マスター管理者パスワードは削除できません");
    });

    it("rejects PUT /api/admin/passwords demoting or deactivating admin-master with 403", async () => {
      const { env } = createSecurityTestEnv();

      // Try to demote admin-master to user
      const demoteReq = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "admin-master",
          role: "user",
        }),
      });
      const demoteRes = await worker.fetch(demoteReq, env as any);
      expect(demoteRes.status).toBe(403);
      const demoteData = await demoteRes.json();
      expect(demoteData.error).toContain(
        "マスター管理者アカウントのロール変更および無効化はできません",
      );

      // Try to deactivate admin-master
      const deactivateReq = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "admin-master",
          isActive: false,
        }),
      });
      const deactivateRes = await worker.fetch(deactivateReq, env as any);
      expect(deactivateRes.status).toBe(403);
    });
  });

  describe("R3 Security and Correctness Hardening: Legacy Protection, Casing & Timing Safety", () => {
    it("timingSafeEqual correctly compares strings and protects against length mismatches", () => {
      expect(timingSafeEqual("abcdef", "abcdef")).toBe(true);
      expect(timingSafeEqual("abcdef", "abcdeg")).toBe(false);
      expect(timingSafeEqual("abcdef", "abcde")).toBe(false);
      expect(timingSafeEqual("", "")).toBe(true);
      expect(timingSafeEqual("a", "")).toBe(false);
    });

    it("prevents non-admin with arbitrary token from deleting unprotected legacy index (403)", async () => {
      const { env, indices } = createSecurityTestEnv();

      // Seed a legacy index without owner_token_hash (null)
      indices.set("legacy-unowned-index", {
        id: "legacy-unowned-index",
        name: "Legacy Protected Index",
        description: "Built without owner token",
        base_value: 1000,
        owner_token_hash: null,
      });

      // Try to delete without admin auth, providing an arbitrary owner token
      const attackerReq = new Request("http://localhost/api/indices?id=legacy-unowned-index", {
        method: "DELETE",
        headers: {
          "x-owner-token": "attacker-random-token-12345",
        },
      });
      const attackerRes = await worker.fetch(attackerReq, env as any);
      // Must be rejected with 403!
      expect(attackerRes.status).toBe(403);
      const attackerData = await attackerRes.json();
      expect(attackerData.error).toContain("管理者権限が必要です");
    });

    it("returns 404 when deleting a non-existent index", async () => {
      const { env } = createSecurityTestEnv();

      const req = new Request("http://localhost/api/indices?id=non-existent-index-xyz", {
        method: "DELETE",
        headers: {
          "x-owner-token": "token",
        },
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("Index not found");
    });

    it("normalizes tickers to uppercase and detects duplicate tickers case-insensitively in POST /api/indices", async () => {
      const { env } = createSecurityTestEnv();

      // Submitting duplicate tickers with different cases (aapl vs AAPL) must be rejected
      const dupReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "case-test-index",
          name: "Case Test Index",
          basket: [
            { ticker: "aapl", name: "Apple Lower", weight: 50 },
            { ticker: "AAPL", name: "Apple Upper", weight: 50 },
          ],
        }),
      });
      const dupRes = await worker.fetch(dupReq, env as any);
      expect(dupRes.status).toBe(400);
      const dupData = await dupRes.json();
      expect(dupData.error).toContain("Duplicate ticker");
    });

    it("detects duplicate tickers case-insensitively in POST /api/calculate", async () => {
      const { env } = createSecurityTestEnv();

      const req = new Request("http://localhost/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basket: [
            { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
            { ticker: "7203", name: "Toyota Dup", theme: "Auto", weight: 50 },
          ],
          baseValue: 1000,
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Duplicate ticker");
    });

    it("R1: prevents non-admin from updating protected index with null owner_token_hash via POST /api/indices", async () => {
      const { env, indices } = createSecurityTestEnv();
      indices.set("protected-legacy-index", {
        id: "protected-legacy-index",
        name: "Protected Legacy",
        description: "No owner token hash",
        base_value: 1000,
        owner_token_hash: null,
      });

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": "attacker-token",
        },
        body: JSON.stringify({
          id: "protected-legacy-index",
          name: "Hijacked Index",
          ownerToken: "attacker-token",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("保護されているため更新できません");
    });

    it("R1: allows admin to update protected index with null owner_token_hash via POST /api/indices", async () => {
      const { env, indices } = createSecurityTestEnv();
      indices.set("protected-legacy-index", {
        id: "protected-legacy-index",
        name: "Protected Legacy",
        description: "No owner token hash",
        base_value: 1000,
        owner_token_hash: null,
      });

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "protected-legacy-index",
          name: "Admin Updated Index",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
    });

    it("R1: prevents non-admin from modifying stock in protected index via POST/DELETE /api/indices/stock", async () => {
      const { env, indices, passwords } = createSecurityTestEnv();
      const userHash = await hashToken("user1234");
      passwords.set("user-1", {
        id: "user-1",
        name: "Regular User",
        password_hash: userHash,
        plain_password: "user1234",
        role: "user",
        max_stocks: 10,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      indices.set("protected-idx", {
        id: "protected-idx",
        name: "Protected",
        description: "Protected index",
        base_value: 1000,
        owner_token_hash: null,
      });

      // POST /api/indices/stock
      const postReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "user1234",
          "x-owner-token": "attacker-token",
        },
        body: JSON.stringify({
          indexId: "protected-idx",
          stock: { ticker: "9984", name: "SoftBank", weight: 50 },
        }),
      });
      const postRes = await worker.fetch(postReq, env as any);
      expect(postRes.status).toBe(403);
      const postData = await postRes.json();
      expect(postData.error).toContain("保護されているため更新できません");

      // DELETE /api/indices/stock
      const delReq = new Request(
        "http://localhost/api/indices/stock?indexId=protected-idx&ticker=9984",
        {
          method: "DELETE",
          headers: {
            "x-auth-password": "user1234",
            "x-owner-token": "attacker-token",
          },
        },
      );
      const delRes = await worker.fetch(delReq, env as any);
      expect(delRes.status).toBe(403);
      const delData = await delRes.json();
      expect(delData.error).toContain("保護されているため銘柄を削除できません");
    });

    it("R1: returns 404 for nonexistent indexId in POST/DELETE /api/indices/stock", async () => {
      const { env, passwords } = createSecurityTestEnv();
      const userHash = await hashToken("user1234");
      passwords.set("user-1", {
        id: "user-1",
        name: "Regular User",
        password_hash: userHash,
        plain_password: "user1234",
        role: "user",
        max_stocks: 10,
        is_active: 1,
        created_at: 1000,
        updated_at: 1000,
      });

      const postReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": "user1234",
        },
        body: JSON.stringify({
          indexId: "non-existent-index",
          stock: { ticker: "9984", name: "SoftBank", weight: 50 },
        }),
      });
      const postRes = await worker.fetch(postReq, env as any);
      expect(postRes.status).toBe(404);

      const delReq = new Request(
        "http://localhost/api/indices/stock?indexId=non-existent-index&ticker=9984",
        {
          method: "DELETE",
          headers: {
            "x-auth-password": "user1234",
          },
        },
      );
      const delRes = await worker.fetch(delReq, env as any);
      expect(delRes.status).toBe(404);
    });

    it("R2: rejects admin-master update via PUT /api/admin/passwords with 403 Forbidden", async () => {
      const { env } = createSecurityTestEnv();

      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "admin-master",
          password: "weakpassword",
        }),
      });
      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("マスター管理者アカウントの変更は専用エンドポイント");
    });

    it("enforces maxIndices limit when user password creates indices", async () => {
      const { env } = createSecurityTestEnv();

      // 1. Admin creates user password with maxIndices: 2
      const createPwdReq = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Limited Index User",
          password: "user-password-123",
          maxStocks: 10,
          maxIndices: 2,
          role: "user",
        }),
      });
      const createPwdRes = await worker.fetch(createPwdReq, env as any);
      expect(createPwdRes.status).toBe(201);
      const pwdData = await createPwdRes.json();
      expect(pwdData.ok).toBe(true);
      expect(pwdData.password.max_indices).toBe(2);

      // 2. User verifies password
      const verifyReq = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "user-password-123" }),
      });
      const verifyRes = await worker.fetch(verifyReq, env as any);
      expect(verifyRes.status).toBe(200);
      const verifyData = await verifyRes.json();
      expect(verifyData.maxIndices).toBe(2);

      const userHeaders = {
        "Content-Type": "application/json",
        "x-auth-password": "user-password-123",
      };

      // 3. User creates 1st index -> Success
      const idx1Req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          id: "custom-idx-1",
          name: "Index 1",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const idx1Res = await worker.fetch(idx1Req, env as any);
      expect(idx1Res.status).toBe(200);

      // 4. User creates 2nd index -> Success
      const idx2Req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          id: "custom-idx-2",
          name: "Index 2",
          basket: [{ ticker: "9984", name: "SoftBank", weight: 100 }],
        }),
      });
      const idx2Res = await worker.fetch(idx2Req, env as any);
      expect(idx2Res.status).toBe(200);

      // 5. User creates 3rd index -> Rejection with 403
      const idx3Req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          id: "custom-idx-3",
          name: "Index 3",
          basket: [{ ticker: "8035", name: "Tokyo Electron", weight: 100 }],
        }),
      });
      const idx3Res = await worker.fetch(idx3Req, env as any);
      expect(idx3Res.status).toBe(403);
      const idx3Data = await idx3Res.json();
      expect(idx3Data.error).toContain("指数作成数を最大2件までに制限されています");

      // 6. User updating an existing index (Index 1) is permitted
      const idx1UpdateReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          ...userHeaders,
          "x-owner-token": (await idx1Res.json()).ownerToken,
        },
        body: JSON.stringify({
          id: "custom-idx-1",
          name: "Index 1 Updated",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const idx1UpdateRes = await worker.fetch(idx1UpdateReq, env as any);
      expect(idx1UpdateRes.status).toBe(200);
    });
  });

  it("rejects authentication with passwords exceeding maximum length (DoS prevention)", async () => {
    const { env } = createSecurityTestEnv();

    // Create a password longer than 100 characters
    const longPassword = "a".repeat(150);

    const req = new Request("http://localhost/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: longPassword }),
    });

    const res = await worker.fetch(req, env as any);
    // Should be rejected with 401 (not authenticated) before any hashing
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
