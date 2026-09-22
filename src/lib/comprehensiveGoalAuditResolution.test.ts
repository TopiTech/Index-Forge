import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, {
  hashPassword,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { getStockCurrency, formatStockPrice, formatStockChange } from "./currency";

const TEST_ADMIN_PASSWORD = "MasterAdminPassword123!";
const EXISTING_USER_PASSWORD = "ExistingUserPassword456!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

async function createMockEnv(overrides?: {
  prepare?: (query: string) => unknown;
  batch?: (statements: unknown[]) => Promise<unknown>;
}) {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const userHash = await hashPassword(EXISTING_USER_PASSWORD);

  const defaultPrepare = vi.fn().mockImplementation((query: string) => ({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
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
      if (query.includes("FROM access_passwords WHERE id != 'admin-master'") || query.includes("FROM access_passwords")) {
        return {
          results: [
            {
              id: "user-1",
              name: "ユーザー1",
              password_hash: userHash,
              role: "user",
              max_stocks: 50,
              max_indices: 5,
              is_active: 1,
              created_at: 1000,
              updated_at: 1000,
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

describe("Comprehensive Goal Audit Resolution Tests", () => {
  describe("Password Collision Enforcement in /api/admin/passwords and /api/admin/admin-password", () => {
    it("POST /api/admin/passwords rejects password colliding with master admin", async () => {
      const env = await createMockEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "新ユーザー",
          password: TEST_ADMIN_PASSWORD,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("PUT /api/admin/passwords rejects updating password to master admin password", async () => {
      const env = await createMockEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "user-1",
          password: TEST_ADMIN_PASSWORD,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "管理者アカウントと同一のパスワードは設定できません" });
    });

    it("PUT /api/admin/admin-password rejects setting master admin password to match existing user password", async () => {
      const env = await createMockEnv();
      const req = new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: EXISTING_USER_PASSWORD,
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data).toEqual({ error: "既存のユーザーアカウントで使用されているパスワードは管理者に設定できません" });
    });

    it("POST /api/admin/passwords succeeds when password is unique", async () => {
      const env = await createMockEnv();
      const req = new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "新規一意ユーザー",
          password: "BrandNewUniquePassword789!",
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty("ok", true);
      expect(data.password).toHaveProperty("name", "新規一意ユーザー");
    });
  });

  describe("Schema Resilience for sort_order column on indices", () => {
    it("GET /api/indices falls back gracefully when sort_order column does not exist", async () => {
      let queryCount = 0;
      const executedQueries: string[] = [];

      const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
      const prepareMock = vi.fn().mockImplementation((query: string) => {
        executedQueries.push(query);
        const stmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
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
            if (query.includes("FROM indices i")) {
              queryCount++;
              if (query.includes("i.sort_order")) {
                // Simulate legacy SQLite error: no such column: i.sort_order
                throw new Error("no such column: i.sort_order");
              }
              // Fallback query without sort_order succeeds
              return {
                results: [
                  {
                    id: "idx-legacy",
                    name: "Legacy Index",
                    description: "No sort order in DB",
                    base_value: 1000,
                    sort_order: 50,
                    ticker: "7203",
                    stock_name: "トヨタ自動車",
                    weight: 100,
                    theme: "自動車",
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
        method: "GET",
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].id).toBe("idx-legacy");
      expect(data[0].sortOrder).toBe(50);
      expect(queryCount).toBe(2); // First failed on i.sort_order, second succeeded on fallback
    });

    it("POST /api/indices retries without sort_order if sort_order column is missing", async () => {
      let batchCount = 0;
      let executedStmts: string[] = [];

      const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
      const prepareMock = vi.fn().mockImplementation((query: string) => {
        const stmt = {
          query,
          bind: vi.fn().mockImplementation((..._params: unknown[]) => {
            return stmt;
          }),
          first: vi.fn().mockResolvedValue(null),
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
            if (query.includes("FROM indices WHERE id = ?")) {
              return {
                results: [
                  {
                    id: "idx-save-test",
                    owner_token_hash: "hash123",
                    creator_id: "admin-master",
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

      const batchMock = vi.fn().mockImplementation(async (stmts: { query: string }[]) => {
        batchCount++;
        executedStmts = stmts.map((s) => s.query || "");
        if (batchCount === 1) {
          // Simulate first batch failing with missing sort_order column
          throw new Error("no such column: sort_order");
        }
        return [{ success: true, meta: { changes: 1 } }];
      });

      const env = await createMockEnv({ prepare: prepareMock, batch: batchMock });

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "idx-save-test",
          name: "Test Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      expect(batchCount).toBe(2);
      // In the second batch, the insert/upsert into indices must NOT have sort_order
      const secondBatchUpsert = executedStmts.find((q) => q.includes("INTO indices"));
      expect(secondBatchUpsert).toBeDefined();
      expect(secondBatchUpsert).not.toContain("sort_order");
    });
  });

  describe("Currency and Stock Price Formatting (JP vs US/Global)", () => {
    it("getStockCurrency accurately distinguishes Japanese vs US tickers", () => {
      // Japanese stock codes (numeric prefix)
      expect(getStockCurrency("7203")).toBe("¥");
      expect(getStockCurrency("9984")).toBe("¥");
      expect(getStockCurrency("6758.T")).toBe("¥");
      expect(getStockCurrency(" 8306 ")).toBe("¥");

      // US and global tickers
      expect(getStockCurrency("AAPL")).toBe("$");
      expect(getStockCurrency("NVDA")).toBe("$");
      expect(getStockCurrency("MSFT")).toBe("$");
      expect(getStockCurrency("TSLA")).toBe("$");
      expect(getStockCurrency("GOOGL")).toBe("$");
    });

    it("formatStockPrice properly formats prices according to currency rules", () => {
      // Invalid / non-positive prices
      expect(formatStockPrice(0, "7203")).toBe("---");
      expect(formatStockPrice(-100, "AAPL")).toBe("---");
      expect(formatStockPrice(Number.NaN, "NVDA")).toBe("---");

      // Japanese stock prices: yen prefix
      expect(formatStockPrice(2850, "7203")).toBe("¥2,850");
      expect(formatStockPrice(8420.5, "9984")).toBe("¥8,420.5");

      // US stock prices: dollar prefix with 2 fraction digits
      expect(formatStockPrice(182.5, "AAPL")).toBe("$182.50");
      expect(formatStockPrice(125, "NVDA")).toBe("$125.00");
      expect(formatStockPrice(450.123, "MSFT")).toBe("$450.12");
    });

    it("formatStockChange formats signed changes with appropriate currency", () => {
      // Japanese changes
      expect(formatStockChange(25, "7203")).toBe("+¥25");
      expect(formatStockChange(-15, "7203")).toBe("-¥15");
      expect(formatStockChange(0, "7203")).toBe("+¥0");

      // US changes
      expect(formatStockChange(3.5, "AAPL")).toBe("+$3.50");
      expect(formatStockChange(-1.25, "NVDA")).toBe("-$1.25");
      expect(formatStockChange(0, "MSFT")).toBe("+$0.00");

      // Non-finite
      expect(formatStockChange(Number.NaN, "AAPL")).toBe("---");
    });
  });
});
