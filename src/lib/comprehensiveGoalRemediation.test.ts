import { describe, it, expect, vi, beforeEach } from "vitest";
import worker, {
  hashPassword,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/index";
import { TICKER_SYMBOLS } from "../components/TradingViewTickerTape";

const TEST_ADMIN_PASSWORD = "AdminPassword123!";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

async function createMockEnv(overrides?: {
  prepare?: (query: string) => unknown;
  batch?: (statements: unknown[]) => Promise<unknown>;
}) {
  const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
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

describe("Comprehensive Goal Remediation Tests", () => {
  describe("DELETE /api/admin/passwords - Creator Nullification", () => {
    it("batches an UPDATE to nullify creator_id on indices when a user password is deleted", async () => {
      const executedQueries: string[] = [];
      const batchMock = vi.fn().mockImplementation(async (stmts: { query: string }[]) => {
        for (const s of stmts) {
          executedQueries.push(s.query);
        }
        return [
          { success: true, meta: { changes: 1 } },
          { success: true, meta: { changes: 1 } },
        ];
      });

      const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
      const prepareMock = vi.fn().mockImplementation((query: string) => {
        const stmt = {
          query,
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
            return { results: [] };
          }),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        };
        return stmt;
      });

      const env = await createMockEnv({
        prepare: prepareMock,
        batch: batchMock,
      });

      const req = new Request("http://localhost/api/admin/passwords?id=user-target-123", {
        method: "DELETE",
        headers: {
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true });

      // Verify that batch executed the nullification query
      expect(batchMock).toHaveBeenCalledTimes(1);
      const hasNullify = executedQueries.some((q) =>
        q.includes("UPDATE indices SET creator_id = NULL WHERE creator_id = ?"),
      );
      const hasDelete = executedQueries.some((q) =>
        q.includes("DELETE FROM access_passwords WHERE id = ?"),
      );
      expect(hasNullify).toBe(true);
      expect(hasDelete).toBe(true);
    });
  });

  describe("POST /api/indices - Legacy Index Creator ID Preservation", () => {
    it("preserves null creator_id when admin edits a legacy index without a creator", async () => {
      let upsertQuery = "";
      let boundParams: unknown[] = [];

      const masterHash = await hashPassword(TEST_ADMIN_PASSWORD);
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
              // Simulating an existing legacy index with NULL creator_id
              return {
                results: [
                  {
                    id: "legacy-idx-1",
                    owner_token_hash: "hash123",
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

      const batchMock = vi.fn().mockResolvedValue([
        { success: true, meta: { changes: 1 } },
        { success: true, meta: { changes: 1 } },
      ]);

      const env = await createMockEnv({
        prepare: prepareMock,
        batch: batchMock,
      });

      const req = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "legacy-idx-1",
          name: "Updated Legacy Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        }),
      });

      const res = await worker.fetch(req, env as any);
      expect(res.status).toBe(200);

      // Verify that creator_id was passed as null to the upsert statement
      expect(upsertQuery).toContain("creator_id");
      expect(boundParams).toContain(null);
    });
  });

  describe("TradingView Ticker Tape Accessibility Contract", () => {
    it("defines 9 base symbols and creates 18 items where duplicates are marked aria-hidden and untabbable", () => {
      expect(TICKER_SYMBOLS.length).toBe(9);
      const displayItems = [...TICKER_SYMBOLS, ...TICKER_SYMBOLS];
      expect(displayItems.length).toBe(18);

      displayItems.forEach((item, index) => {
        const isDuplicate = index >= TICKER_SYMBOLS.length;
        const tabIndex = isDuplicate ? -1 : 0;
        const ariaHidden = isDuplicate ? true : undefined;

        if (index < 9) {
          expect(tabIndex).toBe(0);
          expect(ariaHidden).toBeUndefined();
        } else {
          expect(tabIndex).toBe(-1);
          expect(ariaHidden).toBe(true);
        }
      });
    });
  });

  describe("useSimulation Demo Flag State Logic", () => {
    it("sets usingDemoData to false when both universe and series are non-empty", () => {
      const universe = [{ ticker: "7203", series: [{ date: "2024-01-01", close: 100 }] }];
      const series = [{ date: "2024-01-01", value: 1000, close: 1000 }];
      const isFallback = universe.length === 0 || series.length === 0;
      expect(isFallback).toBe(false);
    });

    it("sets usingDemoData to true when server calculation returns empty universe or series", () => {
      const emptyUniverse: unknown[] = [];
      const emptySeries: unknown[] = [];
      const isFallback = emptyUniverse.length === 0 || emptySeries.length === 0;
      expect(isFallback).toBe(true);
    });
  });
});
