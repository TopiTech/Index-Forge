import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../../worker/index";
import {
  normalizeTicker as workerNormalizeTicker,
  toYahooSymbol as workerToYahooSymbol,
  checkRateLimit,
  clearAuthCache,
  clearMemoryCache,
  resetPasswordTableEnsured,
  RATE_LIMIT_MAX,
} from "../../worker/internal";
import { normalizeTicker as libNormalizeTicker, toYahooSymbol as libToYahooSymbol } from "./yahooSymbol";
import { readJsonBody } from "./apiContract";

describe("Comprehensive Goal Review Cycle Resolution", () => {
  beforeEach(() => {
    clearAuthCache();
    clearMemoryCache();
    resetPasswordTableEnsured();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("Unit 1: Worker Export Parity and Normalization Contract", () => {
    it("re-exports normalizeTicker from worker/internal with full parity to src/lib/yahooSymbol", () => {
      const inputs = ["7203", "９９８４.Ｔ", "  ａａｐｌ  ", "^N225", "USDJPY=X", "  ７２０３  "];
      for (const input of inputs) {
        expect(workerNormalizeTicker(input)).toBe(libNormalizeTicker(input));
        expect(workerToYahooSymbol(input)).toBe(libToYahooSymbol(input));
      }
    });
  });

  describe("Unit 2: checkRateLimit Background Purge Exception Safety", () => {
    it("handles background purge rejection gracefully without throwing unhandled promise errors", async () => {
      // Force Math.random() < 0.01 to trigger purgeExpiredSecurityRows
      vi.spyOn(Math, "random").mockReturnValue(0.005);

      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            run: vi.fn(async () => {
              if (sql.includes("DELETE FROM")) {
                throw new Error("Simulated D1 connection drop during background purge");
              }
              return { meta: { changes: 1 } };
            }),
            all: vi.fn(async () => {
              if (sql.includes("DELETE FROM")) {
                throw new Error("Simulated D1 connection drop during background purge");
              }
              return { results: [] };
            }),
          })),
        })),
        batch: vi.fn(async () => {
          throw new Error("Simulated D1 batch failure during background purge");
        }),
      };

      const mockEnv = {
        DB: mockDb,
        ADMIN_PASSWORD: "test-admin-password",
      };

      // Call checkRateLimit with an execution context
      const waitUntilTasks: Promise<unknown>[] = [];
      const mockCtx = {
        waitUntil: (p: Promise<unknown>) => {
          waitUntilTasks.push(p);
        },
        passThroughOnException: () => {},
      };

      const allowed = await checkRateLimit(
        mockEnv as any,
        "192.168.1.1",
        "test-endpoint",
        RATE_LIMIT_MAX,
        false,
        mockCtx as any,
      );

      expect(allowed).toBe(true);
      expect(waitUntilTasks.length).toBeGreaterThanOrEqual(1);

      // Await the queued background task; it should have caught the rejection and not throw
      await expect(Promise.all(waitUntilTasks)).resolves.toBeDefined();
    });
  });

  describe("Unit 3: API Boundary Full-Width (Zenkaku) Ticker Handling", () => {
    function createWorkerMockEnv() {
      const createStmt = (sql: string) => {
        const stmt = {
          bind: vi.fn(() => stmt),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
          all: vi.fn(async () => {
            if (sql.includes("SELECT") && sql.includes("indices")) {
              return {
                results: [
                  {
                    id: "test-idx",
                    name: "Test Index",
                    description: "",
                    base_value: 1000,
                    sort_order: 1,
                    ticker: "7203",
                    stock_name: "Toyota",
                    weight: 100,
                    theme: "Auto",
                  },
                ],
              };
            }
            return { results: [] };
          }),
          first: vi.fn(async () => null),
        };
        return stmt;
      };

      return {
        DB: {
          prepare: vi.fn((sql: string) => createStmt(sql)),
          batch: vi.fn(async () => []),
        },
        ADMIN_PASSWORD: "test-admin-password",
      };
    }

    it("DELETE /api/indices/stock accepts full-width Zenkaku ticker and normalizes it", async () => {
      const mockEnv = createWorkerMockEnv();
      // 7203 in full-width Zenkaku: ７２０３
      const req = new Request("http://localhost/api/indices/stock?indexId=test-idx&ticker=%EF%BC%97%EF%BC%92%EF%BC%90%EF%BC%93", {
        method: "DELETE",
        headers: {
          "x-admin-password": "test-admin-password",
        },
      });

      const res = await worker.fetch(req, mockEnv as any, {} as any);
      // Must not be 400 Invalid ticker format
      expect(res.status).not.toBe(400);
    });

    it("GET /api/snapshot accepts full-width benchmark symbol and normalizes it", async () => {
      const mockEnv = createWorkerMockEnv();
      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(JSON.stringify({ chart: { result: [{ meta: {}, indicators: { quote: [{}] } }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ));

      // ^N225 in full-width: ＾Ｎ２２５
      const req = new Request("http://localhost/api/snapshot?symbol=%EF%BC%BE%EF%BC%AE%EF%BC%92%EF%BC%92%EF%BC%95", {
        method: "GET",
      });

      const res = await worker.fetch(req, mockEnv as any, {} as any);
      expect(res.status).not.toBe(400);
    });

    it("GET /api/stock/fundamentals accepts full-width ticker and normalizes it", async () => {
      const mockEnv = createWorkerMockEnv();
      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 2500 } }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ));

      // 7203 in full-width: ７２０３
      const req = new Request("http://localhost/api/stock/fundamentals?ticker=%EF%BC%97%EF%BC%92%EF%BC%90%EF%BC%93", {
        method: "GET",
      });

      const res = await worker.fetch(req, mockEnv as any, {} as any);
      expect(res.status).not.toBe(400);
    });

    it("POST /api/sync-prices normalizes and deduplicates duplicate or mixed-width tickers", async () => {
      const boundQueries: unknown[][] = [];
      const mockEnv = {
        DB: {
          prepare: vi.fn((_sql: string) => ({
            bind: vi.fn((...params: unknown[]) => {
              boundQueries.push(params);
              return {
                run: vi.fn(async () => ({ meta: { changes: 1 } })),
                all: vi.fn(async () => ({ results: [] })),
              };
            }),
          })),
          batch: vi.fn(async () => []),
        },
        ADMIN_PASSWORD: "test-admin-password",
      };

      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(JSON.stringify({ chart: { result: [{ timestamp: [1700000000], indicators: { quote: [{ close: [2500] }] } }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      ));

      // Passing both half-width 7203.T and full-width ７２０３.Ｔ
      const req = new Request("http://localhost/api/sync-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers: ["7203.T", "７２０３.Ｔ"] }),
      });

      const res = await worker.fetch(req, mockEnv as any, {} as any);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { results?: Array<{ ticker: string }> };
      expect(body.results).toBeDefined();
      // Must be deduplicated into a single 7203.T entry
      const toyotaEntries = body.results?.filter((r) => r.ticker === "7203.T");
      expect(toyotaEntries?.length).toBe(1);
    });
  });

  describe("Unit 4: readJsonBody Safe Parsing", () => {
    it("returns null instead of throwing SyntaxError when response is HTML or malformed text", async () => {
      const htmlResponse = new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

      const parsed = await readJsonBody(htmlResponse);
      expect(parsed).toBeNull();
    });

    it("successfully parses valid JSON response", async () => {
      const jsonResponse = new Response(JSON.stringify({ series: [{ date: "2026-10-25", close: 100 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const parsed = (await readJsonBody(jsonResponse)) as { series: Array<{ date: string; close: number }> };
      expect(parsed).not.toBeNull();
      expect(parsed.series).toHaveLength(1);
      expect(parsed.series[0].close).toBe(100);
    });
  });
});
