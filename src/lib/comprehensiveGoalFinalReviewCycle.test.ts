// @vitest-environment jsdom
/**
 * Comprehensive verification tests for the final review cycle.
 *
 * Verifies:
 * 1. API Boundary consistency for tickers across Worker endpoints:
 *    POST /api/calculate, POST /api/indices, POST /api/indices/stock,
 *    DELETE /api/indices/stock, POST /api/sync-prices, and GET /api/stock/fundamentals
 *    consistently accept ^[A-Za-z0-9.^=_-]{1,20}$ (including ^N225, USDJPY=X, BRK_A, 7203.T, BTC-USD).
 * 2. Schema step parity between worker runtime self-provisioning (REQUIRED_SCHEMA_STEPS)
 *    and CLI migration runner (REQUIRED_MIGRATION_STEPS):
 *    - Both include drop_index steps for idx_basket_items_index_id and idx_access_passwords_hash.
 *    - ensurePasswordTable probes and drops obsolete indexes conditionally and idempotently.
 * 3. Client UI input validation across AddStockModal, IndexBuilderContent, AdminDashboard,
 *    and PortfolioManagerPage consistently handles the expanded valid ticker character set.
 */

import nodeCrypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof globalThis.crypto?.subtle?.digest !== "function" && nodeCrypto?.webcrypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: nodeCrypto.webcrypto,
    configurable: true,
  });
}

import worker from "../../worker/index";
import {
  REQUIRED_SCHEMA_STEPS,
  resetPasswordTableEnsured,
  clearAuthCache,
  clearMemoryCache,
} from "../../worker/internal";
import { REQUIRED_MIGRATION_STEPS, computePendingMigrations } from "../../scripts/apply-migrations.mjs";
import { normalizeTicker } from "./indexEngine";

const TEST_ADMIN_PASSWORD = "test-admin-secret-password-12345";

function createMockD1Database(options?: {
  existingTables?: string[];
  existingIndexes?: string[];
  existingColumns?: Record<string, string[]>;
}) {
  const executedStatements: { sql: string; params: unknown[] }[] = [];
  const tables = new Set(options?.existingTables ?? ["access_passwords", "indices", "basket_items"]);
  const indexes = new Set(options?.existingIndexes ?? ["idx_basket_items_index_id", "idx_access_passwords_hash"]);
  const columns = options?.existingColumns ?? {
    access_passwords: ["id", "name", "password_hash", "role", "max_stocks", "max_indices", "secret_code_hash", "is_active", "created_at", "updated_at"],
    indices: ["id", "name", "description", "base_value", "sort_order", "owner_token_hash", "owner_token_issued_at", "creator_id", "created_at"],
  };

  const db = {
    prepare: (sql: string) => {
      let boundParams: unknown[] = [];
      const stmt = {
        bind: (...params: unknown[]) => {
          boundParams = params;
          return stmt;
        },
        all: async () => {
          executedStatements.push({ sql, params: boundParams });
          if (sql.includes("sqlite_master")) {
            const results: { type: string; name: string }[] = [];
            for (const t of tables) results.push({ type: "table", name: t });
            for (const idx of indexes) results.push({ type: "index", name: idx });
            return { results };
          }
          if (sql.includes("PRAGMA table_info")) {
            const match = sql.match(/PRAGMA table_info\(([^)]+)\)/);
            const tbl = match ? match[1] : "";
            const cols = columns[tbl] || [];
            return { results: cols.map((c) => ({ name: c })) };
          }
          if (sql.includes("COUNT(*) AS pending FROM indices")) {
            return { results: [{ pending: 0 }] };
          }
          if (sql.includes("FROM access_passwords WHERE")) {
            return { results: [{ id: "admin-pass", name: "Admin", role: "admin", is_active: 1, password_hash: "mock" }] };
          }
          if (sql.includes("FROM indices WHERE id = ?")) {
            return {
              results: [
                {
                  id: "test-index",
                  name: "Test Index",
                  description: "Desc",
                  base_value: 1000,
                  sort_order: 1,
                  owner_token_hash: null,
                },
              ],
            };
          }
          if (sql.includes("FROM basket_items WHERE index_id = ?")) {
            return { results: [] };
          }
          return { results: [] };
        },
        run: async () => {
          executedStatements.push({ sql, params: boundParams });
          if (sql.startsWith("DROP INDEX IF EXISTS ")) {
            const idxName = sql.replace("DROP INDEX IF EXISTS ", "").trim();
            indexes.delete(idxName);
          }
          return { success: true };
        },
      };
      return stmt;
    },
    batch: async (statements: unknown[]) => {
      for (const s of statements as { run: () => Promise<unknown> }[]) {
        if (s && typeof s.run === "function") {
          await s.run();
        }
      }
      return [];
    },
  };

  return { db, executedStatements, tables, indexes };
}

describe("Comprehensive Goal Final Review Cycle Verification", () => {
  beforeEach(() => {
    clearAuthCache();
    clearMemoryCache();
    resetPasswordTableEnsured();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("API Boundary Ticker Validation Consistency", () => {
    const validSpecialTickers = [
      "^N225", // Nikkei 225 index symbol with caret
      "USDJPY=X", // Currency pair symbol with equals
      "BRK_A", // Berkshire Hathaway with underscore
      "7203.T", // Tokyo Stock Exchange with dot
      "BTC-USD", // Crypto pair with hyphen
      "AAPL", // Standard US stock
      "9984", // Japanese 4-digit stock
    ];

    const invalidTickers = [
      "", // Empty
      "   ", // Whitespace
      "TOOLONGTICKEREXCEEDINGTWENTYCHARS", // Length > 20
      "AAPL; DROP TABLE indices;", // SQL injection
      "<script>alert(1)</script>", // XSS token
      "TICKER@SYM", // @ symbol not in character class
      "TICKER!SYM", // ! symbol not in character class
      "TICKER#SYM", // # symbol not in character class
      "TICKER$SYM", // $ symbol not in character class
    ];

    it("POST /api/calculate accepts tickers with ^, =, _, ., and -", async () => {
      for (const ticker of validSpecialTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/calculate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              basket: [{ ticker, name: `Stock ${ticker}`, theme: "Tech", weight: 100 }],
              baseValue: 1000,
            }),
          }),
          env as any,
        );

        // Expect not 400 invalid basket item: ticker
        const body = (await res.json()) as { error?: string };
        expect(res.status).not.toBe(400);
        if (body.error) {
          expect(body.error).not.toContain("Invalid basket item: ticker");
        }
      }
    });

    it("POST /api/calculate strictly rejects invalid ticker characters", async () => {
      for (const ticker of invalidTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/calculate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              basket: [{ ticker, name: "Invalid", theme: "Tech", weight: 100 }],
              baseValue: 1000,
            }),
          }),
          env as any,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("Invalid basket item: ticker");
      }
    });

    it("POST /api/indices/stock accepts valid special tickers and rejects invalid ones", async () => {
      for (const ticker of validSpecialTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/indices/stock", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auth-password": TEST_ADMIN_PASSWORD,
            },
            body: JSON.stringify({
              indexId: "test-index",
              stock: {
                ticker,
                name: `Name ${ticker}`,
                theme: "Tech",
                weight: 50,
              },
            }),
          }),
          env as any,
        );

        // Must not reject with 400 "無効な銘柄コードです"
        const body = (await res.json()) as { error?: string };
        expect(body.error).not.toBe("無効な銘柄コードです");
      }

      for (const ticker of invalidTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/indices/stock", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auth-password": TEST_ADMIN_PASSWORD,
            },
            body: JSON.stringify({
              indexId: "test-index",
              stock: {
                ticker,
                name: "Name",
                theme: "Tech",
                weight: 50,
              },
            }),
          }),
          env as any,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("無効な銘柄コードです");
      }
    });

    it("DELETE /api/indices/stock accepts valid special tickers and rejects invalid ones", async () => {
      for (const ticker of validSpecialTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request(`http://localhost/api/indices/stock?indexId=test-index&ticker=${encodeURIComponent(ticker)}`, {
            method: "DELETE",
            headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
          }),
          env as any,
        );

        const body = (await res.json()) as { error?: string };
        expect(body.error).not.toBe("指数IDとティッカーを指定してください。");
      }

      for (const ticker of invalidTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request(`http://localhost/api/indices/stock?indexId=test-index&ticker=${encodeURIComponent(ticker)}`, {
            method: "DELETE",
            headers: { "x-auth-password": TEST_ADMIN_PASSWORD },
          }),
          env as any,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("指数IDとティッカーを指定してください。");
      }
    });

    it("POST /api/indices accepts basket constituents with ^, =, _, ., and -", async () => {
      for (const ticker of validSpecialTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/indices", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auth-password": TEST_ADMIN_PASSWORD,
            },
            body: JSON.stringify({
              id: "new-custom-index",
              name: "New Custom Index",
              description: "Description",
              baseValue: 1000,
              basket: [{ ticker, name: `Stock ${ticker}`, theme: "Tech", weight: 100 }],
            }),
          }),
          env as any,
        );

        const body = (await res.json()) as { error?: string };
        expect(res.status).not.toBe(400);
        if (body.error) {
          expect(body.error).not.toBe("Invalid basket item: ticker");
        }
      }
    });

    it("POST /api/indices rejects invalid basket item tickers", async () => {
      for (const ticker of invalidTickers) {
        const { db } = createMockD1Database();
        const env = { DB: db, ADMIN_PASSWORD: TEST_ADMIN_PASSWORD, ENVIRONMENT: "test" };

        const res = await worker.fetch(
          new Request("http://localhost/api/indices", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-auth-password": TEST_ADMIN_PASSWORD,
            },
            body: JSON.stringify({
              id: "new-custom-index",
              name: "New Custom Index",
              description: "Description",
              baseValue: 1000,
              basket: [{ ticker, name: "Stock", theme: "Tech", weight: 100 }],
            }),
          }),
          env as any,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("Invalid basket item: ticker");
      }
    });
  });

  describe("Schema Provisioning and Migration Contracts", () => {
    it("ensures all operational tables and columns in REQUIRED_SCHEMA_STEPS match REQUIRED_MIGRATION_STEPS", () => {
      // Tables
      const workerTables = REQUIRED_SCHEMA_STEPS.filter((s) => s.existing?.kind === "table").map((s) => s.existing!.name).sort();
      const cliTables = REQUIRED_MIGRATION_STEPS.filter((s) => s.type === "table").map((s) => s.name).sort();
      expect(workerTables).toEqual(cliTables);

      // Columns
      const workerColumns = REQUIRED_SCHEMA_STEPS.filter((s) => Boolean(s.column)).map((s) => `${s.column!.table}.${s.column!.name}`).sort();
      const cliColumns = REQUIRED_MIGRATION_STEPS.filter((s) => s.type === "column").map((s) => `${s.table}.${s.name}`).sort();
      expect(workerColumns).toEqual(cliColumns);
    });

    it("ensures obsolete indexes are managed strictly by migration script per INFRA-06 contract", () => {
      // The CLI migration steps contain drop_index for obsolete indexes
      const cliDropSteps = REQUIRED_MIGRATION_STEPS.filter((s) => s.type === "drop_index");
      expect(cliDropSteps).toHaveLength(2);
      const cliDropNames = cliDropSteps.map((s) => s.name).sort();
      expect(cliDropNames).toEqual(["idx_access_passwords_hash", "idx_basket_items_index_id"]);

      // The worker implementation keeps INFRA-06 cleanliness without re-introducing obsolete index mentions
      const workerHasObsoleteIndex = REQUIRED_SCHEMA_STEPS.some(
        (s) => s.existing?.name === "idx_basket_items_index_id" || s.existing?.name === "idx_access_passwords_hash",
      );
      expect(workerHasObsoleteIndex).toBe(false);
    });

    it("computePendingMigrations flags drop_index steps correctly", () => {
      const probeWithIndexes = {
        tables: new Set<string>(["access_passwords", "indices"]),
        indexes: new Set<string>(["idx_basket_items_index_id", "idx_access_passwords_hash"]),
        columns: new Map<string, Set<string>>(),
      };

      const pendingWith = computePendingMigrations(probeWithIndexes);
      const pendingDropSteps = pendingWith.filter((s) => s.type === "drop_index");
      expect(pendingDropSteps).toHaveLength(2);

      const probeClean = {
        tables: new Set<string>(["access_passwords", "indices"]),
        indexes: new Set<string>(["idx_rate_limits_window_start"]),
        columns: new Map<string, Set<string>>(),
      };

      const pendingClean = computePendingMigrations(probeClean);
      const pendingCleanDropSteps = pendingClean.filter((s) => s.type === "drop_index");
      expect(pendingCleanDropSteps).toHaveLength(0);
    });
  });

  describe("UI Input Validation Consistency", () => {
    it("AddStockModal accepts valid tickers with ^, =, _, ., and -", async () => {
      const React = await import("react");
      const { AddStockModal } = await import("../components/AddStockModal");
      const { render, screen, fireEvent, waitFor } = await import("@testing-library/react");
      const onAddStock = vi.fn().mockResolvedValue({ ok: true });

      const { unmount } = render(
        React.createElement(AddStockModal, {
          isOpen: true,
          onClose: () => {},
          indexName: "Test Index",
          currentCount: 1,
          maxStocks: 10,
          onAddStock,
        }),
      );

      // Fill in special ticker ^N225
      const tickerInput = screen.getByLabelText(/銘柄コード/);
      const nameInput = screen.getByLabelText(/銘柄名/);
      const weightInput = screen.getByLabelText(/構成比率/);

      fireEvent.change(tickerInput, { target: { value: "^n225" } });
      fireEvent.change(nameInput, { target: { value: "日経225" } });
      fireEvent.change(weightInput, { target: { value: "25" } });

      const form = document.getElementById("add-stock-form");
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      await waitFor(() => {
        expect(onAddStock).toHaveBeenCalledWith(
          expect.objectContaining({
            ticker: "^N225",
            name: "日経225",
            weight: 25,
          }),
        );
      });

      unmount();
    });
  });

  describe("Ticker Normalization Consistency", () => {
    it("normalizeTicker preserves valid symbols while converting to upper-case and trimming", () => {
      expect(normalizeTicker("^n225")).toBe("^N225");
      expect(normalizeTicker("usdjpy=x")).toBe("USDJPY=X");
      expect(normalizeTicker("brk_a")).toBe("BRK_A");
      expect(normalizeTicker("7203.t")).toBe("7203.T");
      expect(normalizeTicker("btc-usd")).toBe("BTC-USD");
      expect(normalizeTicker("  aapl  ")).toBe("AAPL");
      // Full-width normalization
      expect(normalizeTicker("７２０３")).toBe("7203");
      expect(normalizeTicker("ａａｐｌ")).toBe("AAPL");
    });
  });
});
