import { describe, it, expect } from "vitest";
import {
  computePendingMigrations,
  parseCliArgs,
  parseWranglerJson,
  REQUIRED_MIGRATION_STEPS,
  runMigration,
  type MigrationStep,
  type ColumnMigrationStep,
  type IndexMigrationStep,
  type TableMigrationStep,
  type DropIndexMigrationStep,
} from "../../scripts/apply-migrations.mjs";

describe("apply-migrations script", () => {
  describe("parseWranglerJson", () => {
    it("parses wrangler array format with results", () => {
      const input = JSON.stringify([
        {
          results: [
            { name: "indices", type: "table" },
            { name: "idx_rate_limits", type: "index" },
          ],
        },
      ]);
      const res = parseWranglerJson(input);
      expect(res).toHaveLength(2);
      expect(res[0].name).toBe("indices");
    });

    it("parses direct object format with results", () => {
      const input = JSON.stringify({
        results: [{ cid: 0, name: "id", type: "TEXT" }],
      });
      const res = parseWranglerJson(input);
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe("id");
    });

    it("returns empty array on invalid json or unexpected shape", () => {
      expect(parseWranglerJson("not-json")).toEqual([]);
      expect(parseWranglerJson("")).toEqual([]);
      expect(parseWranglerJson("{}")).toEqual([]);
    });
  });

  describe("computePendingMigrations", () => {
    it("returns empty array when all objects already exist (idempotent)", () => {
      const probe = {
        tables: new Set([
          "access_passwords",
          "admin_login_attempts",
          "admin_sessions",
          "benchmark_cache",
          "basket_items",
          "rate_limits",
          "sync_logs",
          "snapshot_cache",
          "stock_prices",
          "stock_series",
          "sync_quota",
          "indices",
        ]),
        indexes: new Set([
          "idx_rate_limits_window_start",
          "idx_sync_quota_day",
          "idx_indices_creator_id",
          "idx_admin_sessions_account_id",
          "idx_admin_sessions_expires_at",
          "idx_admin_login_attempts_purge",
          "idx_access_passwords_created_at",
        ]),
        columns: new Map([
          [
            "access_passwords",
            new Set(["max_indices", "secret_code_hash", "id", "password_hash"]),
          ],
          [
            "indices",
            new Set([
              "id",
              "name",
              "owner_token_hash",
              "owner_token_issued_at",
              "created_at",
              "creator_id",
              "sort_order",
            ]),
          ],
        ]),
      };

      const pending = computePendingMigrations(probe);
      expect(pending).toHaveLength(0);
    });

    it("detects missing columns when parent table exists", () => {
      const probe = {
        tables: new Set([
          "access_passwords",
          "admin_login_attempts",
          "admin_sessions",
          "benchmark_cache",
          "basket_items",
          "rate_limits",
          "sync_logs",
          "snapshot_cache",
          "stock_prices",
          "stock_series",
          "sync_quota",
          "indices",
        ]),
        indexes: new Set([
          "idx_rate_limits_window_start",
          "idx_sync_quota_day",
          "idx_indices_creator_id",
          "idx_admin_sessions_account_id",
          "idx_admin_sessions_expires_at",
          "idx_admin_login_attempts_purge",
          "idx_access_passwords_created_at",
        ]),
        columns: new Map([
          ["access_passwords", new Set(["id", "password_hash"])], // missing max_indices, secret_code_hash
          ["indices", new Set(["id", "name", "base_value"])], // missing owner_token_hash, etc.
        ]),
      };

      const pending = computePendingMigrations(probe);
      const colSteps = pending.filter(
        (s: MigrationStep): s is ColumnMigrationStep => s.type === "column",
      );
      expect(colSteps.length).toBeGreaterThan(0);
      expect(colSteps.some((s: ColumnMigrationStep) => s.table === "indices" && s.name === "owner_token_hash")).toBe(true);
      expect(colSteps.some((s: ColumnMigrationStep) => s.table === "access_passwords" && s.name === "max_indices")).toBe(true);
    });

    it("does not queue ALTER TABLE ADD COLUMN if the table does not exist yet", () => {
      const probe = {
        tables: new Set<string>(),
        indexes: new Set<string>(),
        columns: new Map<string, Set<string>>(),
      };

      const pending = computePendingMigrations(probe);
      // All table and index steps should be queued, but NO column steps
      // because CREATE TABLE covers all columns in fresh databases
      const colSteps = pending.filter(
        (s: MigrationStep): s is ColumnMigrationStep => s.type === "column",
      );
      expect(colSteps).toHaveLength(0);

      const tableSteps = pending.filter(
        (s: MigrationStep): s is TableMigrationStep => s.type === "table",
      );
      expect(tableSteps.length).toBeGreaterThan(0);
    });

    it("detects missing indexes", () => {
      const probe = {
        tables: new Set([
          "access_passwords",
          "admin_login_attempts",
          "admin_sessions",
          "benchmark_cache",
          "basket_items",
          "rate_limits",
          "sync_logs",
          "snapshot_cache",
          "stock_prices",
          "stock_series",
          "sync_quota",
          "indices",
        ]),
        indexes: new Set<string>(), // completely missing indexes
        columns: new Map([
          [
            "access_passwords",
            new Set(["max_indices", "secret_code_hash", "id", "password_hash"]),
          ],
          [
            "indices",
            new Set([
              "owner_token_hash",
              "owner_token_issued_at",
              "created_at",
              "creator_id",
              "sort_order",
            ]),
          ],
        ]),
      };

      const pending = computePendingMigrations(probe);
      const indexSteps = pending.filter(
        (s: MigrationStep): s is IndexMigrationStep => s.type === "index",
      );
      expect(indexSteps.length).toBe(
        REQUIRED_MIGRATION_STEPS.filter(
          (s: MigrationStep): s is IndexMigrationStep => s.type === "index",
        ).length,
      );
    });

    it("detects unnecessary indexes that should be dropped", () => {
      const probe = {
        tables: new Set<string>(),
        indexes: new Set(["idx_basket_items_index_id", "idx_access_passwords_hash"]),
        columns: new Map<string, Set<string>>(),
      };

      const pending = computePendingMigrations(probe);
      const dropSteps = pending.filter(
        (s: MigrationStep): s is DropIndexMigrationStep => s.type === "drop_index",
      );
      expect(dropSteps).toHaveLength(2);
      expect(dropSteps.map((s) => s.name)).toContain("idx_basket_items_index_id");
      expect(dropSteps.map((s) => s.name)).toContain("idx_access_passwords_hash");
    });

    it("queues owner_token_issued_at column when missing from indices table", () => {
      const probe = {
        tables: new Set(["indices"]),
        indexes: new Set<string>(),
        columns: new Map([
          ["indices", new Set(["id", "name", "owner_token_hash"])], // missing owner_token_issued_at
        ]),
      };

      const pending = computePendingMigrations(probe);
      const colSteps = pending.filter(
        (s: MigrationStep): s is ColumnMigrationStep => s.type === "column",
      );
      expect(colSteps.some((s) => s.table === "indices" && s.name === "owner_token_issued_at")).toBe(true);
    });
  });

  describe("runMigration export contract", () => {
    it("exports runMigration as a function matching declaration", () => {
      expect(typeof runMigration).toBe("function");
    });
  });

  describe("parseCliArgs", () => {
    it("returns default values when no arguments are provided", () => {
      const parsed = parseCliArgs([]);
      expect(parsed).toEqual({
        targetFlag: "--local",
        configPath: "wrangler.local.jsonc",
        dbName: "original-stock-index-db",
      });
    });

    it("parses --remote and --local target flags", () => {
      expect(parseCliArgs(["--remote"]).targetFlag).toBe("--remote");
      expect(parseCliArgs(["--local"]).targetFlag).toBe("--local");
    });

    it("parses --config <path> and --config=<path>", () => {
      expect(parseCliArgs(["--config", "wrangler.jsonc"]).configPath).toBe("wrangler.jsonc");
      expect(parseCliArgs(["--config=custom.wrangler.jsonc"]).configPath).toBe("custom.wrangler.jsonc");
    });

    it("parses --database <name> and --database=<name>", () => {
      expect(parseCliArgs(["--database", "my-stock-db"]).dbName).toBe("my-stock-db");
      expect(parseCliArgs(["--database=production-db"]).dbName).toBe("production-db");
    });

    it("parses --db <name> and --db=<name>", () => {
      expect(parseCliArgs(["--db", "short-db"]).dbName).toBe("short-db");
      expect(parseCliArgs(["--db=short-eq-db"]).dbName).toBe("short-eq-db");
    });

    it("parses mixed options correctly", () => {
      const parsed = parseCliArgs([
        "--remote",
        "--config",
        "wrangler.production.jsonc",
        "--db",
        "cloud-stock-db",
      ]);
      expect(parsed).toEqual({
        targetFlag: "--remote",
        configPath: "wrangler.production.jsonc",
        dbName: "cloud-stock-db",
      });
    });

    it("retains defaults when option flags lack values", () => {
      const parsed = parseCliArgs(["--config", "--db"]);
      expect(parsed).toEqual({
        targetFlag: "--local",
        configPath: "wrangler.local.jsonc",
        dbName: "original-stock-index-db",
      });
    });
  });
});
