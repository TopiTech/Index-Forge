import { beforeEach, describe, it, expect } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  hashToken,
} from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "test-admin-password";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

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

function createTestEnv() {
  const passwords = new Map<string, PasswordRecord>();

  const executeAll = (query: string, params: unknown[] = []) => {
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords WHERE id = ?")) {
      const id = params[0] as string;
      const p = passwords.get(id);
      return { results: p ? [p] : [] };
    }
    if (query.includes("FROM access_passwords WHERE id != 'admin-master'")) {
      const matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
      return { results: matches };
    }
    if (query.includes("FROM access_passwords")) {
      return { results: Array.from(passwords.values()) };
    }
    return { results: [] };
  };

  const executeRun = (query: string, params: unknown[] = []) => {
    if (query.includes("UPDATE access_passwords")) {
      const targetId = params[params.length - 1] as string;
      const existing = passwords.get(targetId);
      if (existing) {
        const updated = { ...existing };
        if (query.includes("role = ?")) {
          const roleParam = params.find((p) => p === "admin" || p === "user");
          if (roleParam) updated.role = roleParam as "admin" | "user";
        }
        if (query.includes("name = ?")) {
          updated.name = params[0] as string;
        }
        if (query.includes("password_hash = ?")) {
          const hashIndex = query.split(",").findIndex((s) => s.includes("password_hash"));
          if (hashIndex >= 0) updated.password_hash = params[hashIndex] as string;
        }
        passwords.set(targetId, updated);
      }
      return { success: true, meta: { changes: existing ? 1 : 0 } };
    }
    return { success: true, meta: { changes: 1 } };
  };

  const prepare = (query: string) => {
    return {
      bind: (...params: unknown[]) => ({
        all: async () => executeAll(query, params),
        run: async () => executeRun(query, params),
      }),
      all: async () => executeAll(query),
      run: async () => executeRun(query),
    };
  };

  const env = {
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    DB: {
      prepare,
      batch: async (statements: any[]) => {
        for (const stmt of statements) {
          if (typeof stmt?.run === "function") await stmt.run();
        }
        return [];
      },
    },
  };

  return { env, passwords };
}

describe("Comprehensive Code Review Fixes: Admin Role Promotion & Password Security", () => {
  it("rejects promoting a user account to admin when its existing password collides with another user account", async () => {
    const { env, passwords } = createTestEnv();
    const sharedHash = await hashToken("shared-user-password-123");

    // Two users share the same password
    passwords.set("pwd-user-1", {
      id: "pwd-user-1",
      name: "User One",
      password_hash: sharedHash,
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });
    passwords.set("pwd-user-2", {
      id: "pwd-user-2",
      name: "User Two",
      password_hash: sharedHash,
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 2000,
      updated_at: 2000,
    });

    // Attempt to promote User One to admin without specifying a new password
    const updateReq = new Request("http://localhost/api/admin/passwords", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "pwd-user-1",
        role: "admin",
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toContain("既存のアカウントと同一のパスワードが設定されているため管理者に昇格できません");
    // Ensure role was NOT updated
    expect(passwords.get("pwd-user-1")?.role).toBe("user");
  });

  it("rejects promoting a user account to admin when its existing password collides with master admin", async () => {
    const { env, passwords } = createTestEnv();
    const masterAdminHash = await hashToken(TEST_ADMIN_PASSWORD);

    passwords.set("pwd-user-colliding-master", {
      id: "pwd-user-colliding-master",
      name: "Sneaky User",
      password_hash: masterAdminHash,
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
        id: "pwd-user-colliding-master",
        role: "admin",
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toContain("管理者アカウントと同一のパスワードは設定できません");
    expect(passwords.get("pwd-user-colliding-master")?.role).toBe("user");
  });

  it("allows promoting a user account to admin when its existing password is unique", async () => {
    const { env, passwords } = createTestEnv();
    const uniqueHash = await hashToken("unique-user-pass-999");

    passwords.set("pwd-user-unique", {
      id: "pwd-user-unique",
      name: "Unique User",
      password_hash: uniqueHash,
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
        id: "pwd-user-unique",
        role: "admin",
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(200);
    expect(passwords.get("pwd-user-unique")?.role).toBe("admin");
  });

  it("allows promoting a user account to admin when providing a new non-colliding password", async () => {
    const { env, passwords } = createTestEnv();
    const sharedHash = await hashToken("shared-user-password-123");

    passwords.set("pwd-user-promote-new-pw", {
      id: "pwd-user-promote-new-pw",
      name: "Promoted With New Password",
      password_hash: sharedHash,
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
        id: "pwd-user-promote-new-pw",
        role: "admin",
        password: "BrandNewSecureAdminPass2026!",
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(200);
    expect(passwords.get("pwd-user-promote-new-pw")?.role).toBe("admin");
  });

  it("allows updating standard user attributes (name, maxStocks) even if password is shared with another user", async () => {
    const { env, passwords } = createTestEnv();
    const sharedHash = await hashToken("shared-user-password-123");

    passwords.set("pwd-user-a", {
      id: "pwd-user-a",
      name: "User A",
      password_hash: sharedHash,
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });
    passwords.set("pwd-user-b", {
      id: "pwd-user-b",
      name: "User B",
      password_hash: sharedHash,
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 2000,
      updated_at: 2000,
    });

    // Update name of User A without changing role
    const updateReq = new Request("http://localhost/api/admin/passwords", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "pwd-user-a",
        name: "User A Renamed",
        maxStocks: 25,
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(200);
    expect(passwords.get("pwd-user-a")?.name).toBe("User A Renamed");
    expect(passwords.get("pwd-user-a")?.role).toBe("user");
  });
});
