import { beforeEach, describe, it, expect } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
  hashToken,
  hashPassword,
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
    // Salted PBKDF2 hashes make hash-string comparisons unable to detect this
    // collision, so promotion without a new password is rejected outright and
    // the admin must supply a fresh password that findPasswordCollision() can
    // verify.
    expect(data.error).toContain("新しいパスワードを指定してください");
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
    expect(data.error).toContain("新しいパスワードを指定してください");
    expect(passwords.get("pwd-user-colliding-master")?.role).toBe("user");
  });

  it("rejects promoting a user account to admin without a new password even when the existing password is unique", async () => {
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

    // Uniqueness cannot be proven from a salted hash, so the promotion itself
    // must be rejected: silently promoting a shared password let the other
    // account's holder log in as the new admin.
    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toContain("新しいパスワードを指定してください");
    expect(passwords.get("pwd-user-unique")?.role).toBe("user");
  });

  it("rejects promoting to admin with a new password that collides with another user's PBKDF2 password", async () => {
    const { env, passwords } = createTestEnv();
    const otherUserPassword = "other-user-pbkdf2-password-77";

    // Modern accounts store salted PBKDF2 hashes; the collision check must
    // still detect the shared password via verification, not string equality.
    passwords.set("pwd-user-target", {
      id: "pwd-user-target",
      name: "Promotion Target",
      password_hash: await hashPassword("target-user-existing-password-1"),
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 1000,
      updated_at: 1000,
    });
    passwords.set("pwd-user-other", {
      id: "pwd-user-other",
      name: "Other User",
      password_hash: await hashPassword(otherUserPassword),
      role: "user",
      max_stocks: 10,
      is_active: 1,
      created_at: 2000,
      updated_at: 2000,
    });

    const updateReq = new Request("http://localhost/api/admin/passwords", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "pwd-user-target",
        role: "admin",
        password: otherUserPassword,
      }),
    });

    const updateRes = await worker.fetch(updateReq, env as any);
    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toContain(
      "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません",
    );
    expect(passwords.get("pwd-user-target")?.role).toBe("user");
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
