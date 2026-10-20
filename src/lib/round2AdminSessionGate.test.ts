import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  hashPassword,
  hashToken,
  resetPasswordTableEnsured,
  setAllowPasswordAdminFallbackForTests,
} from "../../worker/internal";

/**
 * SEC-01: the administrator session is the only credential that authorises a
 * privileged call in production.
 *
 * The pre-existing suite authenticates `/api/admin/*` with the administrator
 * password alone, because the Worker's `authenticateAdmin` keeps a test-only
 * fallback for that. This file turns that fallback off and pins the real
 * behaviour: without a valid `x-admin-session` the request is refused, with one
 * it succeeds. Without this test the whole suite would pass even if the
 * production branch were deleted.
 */
const TEST_ADMIN_PASSWORD = "test-master-admin-pwd-2026";
const ADMIN_SESSION_TOKEN = "s".repeat(64);
const OTHER_SESSION_TOKEN = "x".repeat(64);

interface AdminRow {
  id: string;
  name: string;
  password_hash: string;
  secret_code_hash: string | null;
  role: string;
  max_stocks: number | null;
  max_indices: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

async function createEnv(): Promise<{
  env: Record<string, unknown>;
  sessionHash: string;
}> {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const sessionHash = await hashToken(ADMIN_SESSION_TOKEN);

  const adminRow: AdminRow = {
    id: "admin-master",
    name: "管理者",
    password_hash: masterHash,
    secret_code_hash: null,
    role: "admin",
    max_stocks: null,
    max_indices: null,
    is_active: 1,
    created_at: 0,
    updated_at: 0,
  };

  const executeQuery = async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM admin_sessions")) {
      // The Worker looks the session up by the SHA-256 of the presented token.
      if (params[0] !== sessionHash) return { results: [] };
      return {
        results: [
          {
            account_id: "admin-master",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            name: adminRow.name,
            role: adminRow.role,
            is_active: adminRow.is_active,
            max_stocks: adminRow.max_stocks,
            max_indices: adminRow.max_indices,
          },
        ],
      };
    }
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      return { results: [adminRow] };
    }
    if (query.includes("FROM access_passwords")) {
      return { results: [] };
    }
    return { results: [] };
  };

  const prepareMock = vi.fn().mockImplementation((query: string) => {
    const statement = {
      bind: vi.fn().mockImplementation((...params: unknown[]) => ({
        all: () => executeQuery(query, params),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      })),
      all: () => executeQuery(query, []),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    };
    return statement;
  });

  return {
    env: {
      ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })) },
      DB: { prepare: prepareMock, batch: vi.fn().mockResolvedValue([]) },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    },
    sessionHash,
  };
}

describe("administrator session gate (production behaviour)", () => {
  beforeEach(() => {
    resetPasswordTableEnsured();
    clearAuthCache();
    setAllowPasswordAdminFallbackForTests(false);
  });

  afterEach(() => {
    setAllowPasswordAdminFallbackForTests(null);
    resetPasswordTableEnsured();
    clearAuthCache();
  });

  it("refuses a password-only administrator request when the fallback is disabled", async () => {
    const { env } = await createEnv();
    const req = new Request("http://localhost/api/admin/passwords", {
      headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(403);
    const data = (await res.json()) as Record<string, unknown>;
    expect(String(data.error ?? "")).toContain("管理者");
  });

  it("refuses a request that carries an unknown session token", async () => {
    const { env } = await createEnv();
    const req = new Request("http://localhost/api/admin/passwords", {
      headers: {
        "x-auth-password": TEST_ADMIN_PASSWORD,
        "x-admin-session": OTHER_SESSION_TOKEN,
      },
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(403);
  });

  it("accepts a request that carries a valid administrator session", async () => {
    const { env } = await createEnv();
    const req = new Request("http://localhost/api/admin/passwords", {
      headers: { "x-admin-session": ADMIN_SESSION_TOKEN },
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(200);
    // The endpoint answers with the list itself (an empty list here).
    const data = (await res.json()) as unknown;
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("still accepts the password-only request while the test-only fallback is enabled", async () => {
    // The fallback exists so the pre-existing suite can drive the admin API.
    // It must be reachable only from the test runtime, and this test documents
    // that the switch is what turns it on.
    setAllowPasswordAdminFallbackForTests(true);
    const { env } = await createEnv();
    const req = new Request("http://localhost/api/admin/passwords", {
      headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
    });

    const res = await worker.fetch(req, env as never);

    expect(res.status).toBe(200);
  });
});
