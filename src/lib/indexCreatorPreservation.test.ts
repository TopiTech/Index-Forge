import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../worker/index";
import {
  hashPassword,
  hashToken,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/internal";

const TEST_ADMIN_PASSWORD = "AdminPassword123!";
const TEST_USER_PASSWORD = "UserPassword123!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

async function createMockEnv(overrides?: {
  prepare?: (query: string) => unknown;
  batch?: (statements: unknown[]) => Promise<unknown>;
}) {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const userHash = await hashPassword(TEST_USER_PASSWORD);

  const defaultPrepare = vi.fn().mockImplementation((query: string) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockImplementation(async () => null),
    all: vi.fn().mockImplementation(async () => {
      if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
        return {
          results: [
            {
              id: "admin-master",
              name: "マスター管理者",
              password_hash: masterHash,
              role: "admin",
              max_stocks: null,
              max_indices: null,
              is_active: 1,
            },
          ],
        };
      }
      if (
        query.includes("FROM access_passwords WHERE is_active = 1") ||
        query.includes("FROM access_passwords WHERE password_hash = ?") ||
        query.includes("FROM access_passwords WHERE id = 'test-user-1'")
      ) {
        return {
          results: [
            {
              id: "test-user-1",
              name: "テストユーザー",
              password_hash: userHash,
              role: "user",
              max_stocks: 20,
              max_indices: 10,
              is_active: 1,
            },
          ],
        };
      }
      return { results: [] };
    }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
  }));

  const mockDb = {
    prepare: overrides?.prepare ?? defaultPrepare,
    batch: overrides?.batch ?? vi.fn().mockResolvedValue([{ success: true, meta: { changes: 1 } }]),
  };

  return {
    DB: mockDb,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset content", { status: 200 })),
    },
  };
}

describe("POST /api/indices - creator_id preservation", () => {
  it("preserves original user creator_id when updated by an admin", async () => {
    let boundParams: unknown[] = [];
    let upsertQuery = "";

    const ownerToken = "secret-owner-token-123";
    const ownerTokenHash = await hashToken(ownerToken);

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      const stmt = {
        bind: vi.fn().mockImplementation((...params: unknown[]) => {
          if (query.includes("INTO indices")) {
            upsertQuery = query;
            boundParams = params;
          }
          return stmt;
        }),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
            return {
              results: [
                {
                  id: "admin-master",
                  name: "管理者",
                  password_hash: masterHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          if (query.includes("FROM indices WHERE id = ?")) {
            // Index created by test-user-1
            return {
              results: [
                {
                  id: "user-idx-1",
                  owner_token_hash: ownerTokenHash,
                  creator_id: "test-user-1",
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return stmt;
    });

    const env = await createMockEnv({ prepare: prepareMock });

    // Admin updates the user's index
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "user-idx-1",
        name: "Admin Updated Index",
        basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    // Verify creator_id is bound as 'test-user-1', NOT 'admin-master'
    expect(upsertQuery).toContain("creator_id");
    expect(boundParams).toContain("test-user-1");
    expect(boundParams).not.toContain("admin-master");
  });

  it("preserves original user creator_id when updated via ownerToken without password authentication", async () => {
    let boundParams: unknown[] = [];
    let upsertQuery = "";

    const ownerToken = "secret-owner-token-456";
    const ownerTokenHash = await hashToken(ownerToken);

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      const stmt = {
        bind: vi.fn().mockImplementation((...params: unknown[]) => {
          if (query.includes("INTO indices")) {
            upsertQuery = query;
            boundParams = params;
          }
          return stmt;
        }),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("FROM indices WHERE id = ?")) {
            return {
              results: [
                {
                  id: "user-idx-2",
                  owner_token_hash: ownerTokenHash,
                  creator_id: "test-user-1",
                },
              ],
            };
          }
          if (query.includes("FROM access_passwords WHERE id = ?")) {
            return {
              results: [{ max_stocks: 25 }],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return stmt;
    });

    const env = await createMockEnv({ prepare: prepareMock });

    // User updates index with ownerToken only (guest / unauthenticated session)
    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-owner-token": ownerToken,
      },
      body: JSON.stringify({
        id: "user-idx-2",
        name: "Token Updated Index",
        basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    // Verify creator_id is preserved as 'test-user-1', NOT null
    expect(upsertQuery).toContain("creator_id");
    expect(boundParams).toContain("test-user-1");
  });

  it("preserves null creator_id when admin edits a legacy index without creator_id", async () => {
    let boundParams: unknown[] = [];
    let upsertQuery = "";

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      const stmt = {
        bind: vi.fn().mockImplementation((...params: unknown[]) => {
          if (query.includes("INTO indices")) {
            upsertQuery = query;
            boundParams = params;
          }
          return stmt;
        }),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
            const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
            return {
              results: [
                {
                  id: "admin-master",
                  name: "管理者",
                  password_hash: masterHash,
                  role: "admin",
                  max_stocks: null,
                  max_indices: null,
                  is_active: 1,
                },
              ],
            };
          }
          if (query.includes("FROM indices WHERE id = ?")) {
            return {
              results: [
                {
                  id: "legacy-idx",
                  owner_token_hash: "hash",
                  creator_id: null,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return stmt;
    });

    const env = await createMockEnv({ prepare: prepareMock });

    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_ADMIN_PASSWORD,
      },
      body: JSON.stringify({
        id: "legacy-idx",
        name: "Legacy Index Updated",
        basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    expect(upsertQuery).toContain("creator_id");
    expect(boundParams).toContain(null);
  });

  it("assigns authenticated user id as creator_id when creating a new index", async () => {
    let boundParams: unknown[] = [];
    let upsertQuery = "";

    const userHash = await hashPassword(TEST_USER_PASSWORD);

    const prepareMock = vi.fn().mockImplementation((query: string) => {
      const stmt = {
        bind: vi.fn().mockImplementation((...params: unknown[]) => {
          if (query.includes("INTO indices")) {
            upsertQuery = query;
            boundParams = params;
          }
          return stmt;
        }),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockImplementation(async () => {
          if (
            query.includes("FROM access_passwords WHERE is_active = 1") ||
            query.includes("FROM access_passwords WHERE password_hash = ?")
          ) {
            return {
              results: [
                {
                  id: "test-user-1",
                  name: "テストユーザー",
                  password_hash: userHash,
                  role: "user",
                  max_stocks: 20,
                  max_indices: 10,
                  is_active: 1,
                },
              ],
            };
          }
          if (query.includes("SELECT COUNT(*) as count FROM indices WHERE creator_id = ?")) {
            return { results: [{ count: 1 }] };
          }
          if (query.includes("FROM indices WHERE id = ?")) {
            return { results: [] }; // Does not exist -> new index
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      };
      return stmt;
    });

    const env = await createMockEnv({ prepare: prepareMock });

    const req = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-password": TEST_USER_PASSWORD,
      },
      body: JSON.stringify({
        id: "brand-new-user-idx",
        name: "Brand New User Index",
        basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
      }),
    });

    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(200);

    expect(upsertQuery).toContain("creator_id");
    expect(boundParams).toContain("test-user-1");
  });
});

describe("CalendarPage Export UX & Toast Integration", () => {
  it("integrates useToast in CalendarPage for export confirmation and empty state feedback", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const calendarPagePath = path.resolve(process.cwd(), "src/components/CalendarPage.tsx");
    const content = fs.readFileSync(calendarPagePath, "utf-8");

    expect(content).toContain('import { useToast } from "./Toast";');
    expect(content).toContain("const { success: toastSuccess, info: toastInfo } = useToast();");
    expect(content).toContain('toastInfo("エクスポート対象のイベントがありません")');
    expect(content).toContain('toastSuccess("カレンダー (.ics) をダウンロードしました")');
    expect(content).toContain('toastSuccess(`${filteredEvents.length}件のイベントをCSVエクスポートしました`)');
  });
});

