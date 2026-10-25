/**
 * INFRA-05 — executable contract for `schema.sql`.
 *
 * The schema used to be covered only by string assertions ("schema.sql
 * contains this CREATE TABLE"), which cannot fail for a table that is
 * syntactically wrong, an index that does not cover the query it was added
 * for, or a constraint that SQLite silently ignores. This suite applies the
 * real file to a throwaway in-memory SQLite database (`node:sqlite`, no
 * network, no Wrangler, no D1 account) and then exercises the statements the
 * Worker actually runs.
 *
 * Requires Node >= 22.13 (`node:sqlite` is available without the
 * `--experimental-sqlite` flag since 22.13.0 / 23.4.0).
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";

type Row = Record<string, SQLOutputValue>;
type SqliteModule = typeof import("node:sqlite");

const schemaSql = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../../schema.migration.sql", import.meta.url), "utf8");

/** Every table the Worker reads or writes. */
const EXPECTED_TABLES = [
  "indices",
  "basket_items",
  "stock_series",
  "stock_prices",
  "sync_logs",
  "snapshot_cache",
  "benchmark_cache",
  "rate_limits",
  "access_passwords",
  "admin_login_attempts",
  "admin_sessions",
  "sync_quota",
] as const;

/** Indexes backed by a query that would otherwise scan the table. */
const EXPECTED_INDEXES = [
  "idx_rate_limits_window_start",
  "idx_indices_creator_id",
  "idx_admin_sessions_account_id",
  "idx_admin_sessions_expires_at",
] as const;

/**
 * Dropped as redundant: `idx_basket_items_index_id` only repeats the prefix of
 * `UNIQUE(index_id, ticker)` and `idx_access_passwords_hash` backed a lookup
 * that does not exist (password hashes are salted, so they are never searched).
 * Re-adding either one only costs a write per row.
 */
const REDUNDANT_INDEXES = ["idx_basket_items_index_id", "idx_access_passwords_hash"] as const;

const RATE_LIMIT_WINDOW_SECONDS = 60;

let sqlite: SqliteModule;
let db: DatabaseSync;
let restoreEmitWarning: (() => void) | undefined;

/**
 * `node:sqlite` is a Release Candidate: Node versions before it stabilised
 * print `ExperimentalWarning: SQLite is an experimental feature ...` on first
 * use. Silence exactly that message for this file only — no `NODE_OPTIONS`, no
 * `--no-warnings`, and every other warning still reaches stderr.
 */
function silenceSqliteExperimentalWarning(): () => void {
  const original = process.emitWarning;
  const patched = (warning: string | Error, ...rest: unknown[]): void => {
    const message = typeof warning === "string" ? warning : warning.message;
    if (message.includes("SQLite is an experimental feature")) return;
    (original as unknown as (...args: unknown[]) => void).call(process, warning, ...rest);
  };
  process.emitWarning = patched as typeof process.emitWarning;
  return () => {
    process.emitWarning = original;
  };
}

function all(sql: string, ...params: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...params);
}

function one(sql: string, ...params: SQLInputValue[]): Row {
  const row = db.prepare(sql).get(...params);
  if (!row) throw new Error(`Expected one row from: ${sql}`);
  return row;
}

/** Runs a write and normalises `changes` (number | bigint) to a number. */
function run(sql: string, ...params: SQLInputValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

function objectNames(type: "table" | "index"): Set<string> {
  return new Set(all("SELECT name FROM sqlite_master WHERE type = ?", type).map((row) => String(row.name)));
}

beforeAll(async () => {
  restoreEmitWarning = silenceSqliteExperimentalWarning();
  sqlite = await import("node:sqlite");
});

afterAll(() => {
  restoreEmitWarning?.();
});

beforeEach(() => {
  db = new sqlite.DatabaseSync(":memory:");
  // Explicit even though `node:sqlite` enables them by default: the cascade
  // assertion below must fail loudly if the runtime default ever changes.
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
});

afterEach(() => {
  db.close();
});

describe("schema.sql applies cleanly", () => {
  it("creates every table the Worker queries", () => {
    const tables = objectNames("table");
    for (const table of EXPECTED_TABLES) {
      expect(tables.has(table), `schema.sql must create the table "${table}"`).toBe(true);
    }
  });

  it("creates the covering indexes and none of the redundant ones", () => {
    const indexes = objectNames("index");
    for (const index of EXPECTED_INDEXES) {
      expect(indexes.has(index), `schema.sql must create the index "${index}"`).toBe(true);
    }
    for (const index of REDUNDANT_INDEXES) {
      expect(indexes.has(index), `"${index}" was dropped as redundant`).toBe(false);
    }
  });

  it("keeps UNIQUE(index_id, ticker) as the prefix that replaced idx_basket_items_index_id", () => {
    const uniqueIndexes = all("PRAGMA index_list('basket_items')").filter(
      (row) => Number(row.unique) === 1,
    );
    const covered = uniqueIndexes.some((index) => {
      const columns = all(`PRAGMA index_info('${String(index.name)}')`).map((column) =>
        String(column.name),
      );
      return columns.join(",") === "index_id,ticker";
    });
    expect(covered, "basket_items needs a unique index on (index_id, ticker)").toBe(true);
  });
});

describe("snapshot_cache", () => {
  it("is a single-row table enforced by CHECK (id = 1)", () => {
    const ddl = String(
      one("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'snapshot_cache'").sql,
    );
    expect(ddl).toMatch(/CHECK\s*\(\s*id\s*=\s*1\s*\)/i);

    expect(run("INSERT INTO snapshot_cache (id, data, cached_at) VALUES (1, ?, ?)", "{}", 100)).toBe(1);
    // Any other id must be rejected by the database, not by the caller.
    expect(() =>
      run("INSERT INTO snapshot_cache (id, data, cached_at) VALUES (2, '{}', 100)"),
    ).toThrow(/CHECK constraint failed/i);

    expect(
      run(
        "INSERT INTO snapshot_cache (id, data, cached_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at",
        '{"stale":false}',
        200,
      ),
    ).toBe(1);
    expect(one("SELECT data, cached_at FROM snapshot_cache").cached_at).toBe(200);
    expect(Number(one("SELECT COUNT(*) AS n FROM snapshot_cache").n)).toBe(1);
  });
});

describe("indices and basket_items", () => {
  it("stores a weighted basket and cascades index deletion to its rows", () => {
    expect(
      run(
        "INSERT INTO indices (id, name, description, base_value, sort_order, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        "idx-1",
        "テスト指数",
        "contract test",
        1000,
        1,
        "user-1",
        1_700_000_000,
      ),
    ).toBe(1);
    run(
      "INSERT INTO basket_items (index_id, ticker, name, weight, theme) VALUES (?, ?, ?, ?, ?)",
      "idx-1",
      "7203.T",
      "Toyota",
      60,
      "transport",
    );
    run(
      "INSERT INTO basket_items (index_id, ticker, name, weight, theme) VALUES (?, ?, ?, ?, ?)",
      "idx-1",
      "6758.T",
      "Sony",
      40,
      "tech",
    );

    expect(Number(one("SELECT SUM(weight) AS total FROM basket_items WHERE index_id = ?", "idx-1").total)).toBe(100);
    expect(
      all("SELECT ticker FROM basket_items WHERE index_id = ? ORDER BY ticker", "idx-1").map((row) =>
        String(row.ticker),
      ),
    ).toEqual(["6758.T", "7203.T"]);

    // The save path relies on the unique pair to make re-saving a basket
    // idempotent instead of duplicating rows.
    expect(() =>
      run(
        "INSERT INTO basket_items (index_id, ticker, name, weight) VALUES ('idx-1', '7203.T', 'dup', 10)",
      ),
    ).toThrow(/UNIQUE constraint failed/i);

    expect(() =>
      run(
        "INSERT INTO basket_items (index_id, ticker, name, weight) VALUES ('missing', '7203.T', 'orphan', 10)",
      ),
    ).toThrow(/FOREIGN KEY constraint failed/i);

    expect(run("UPDATE basket_items SET weight = ? WHERE index_id = ? AND ticker = ?", 65, "idx-1", "7203.T")).toBe(1);
    expect(
      Number(one("SELECT weight FROM basket_items WHERE index_id = ? AND ticker = ?", "idx-1", "7203.T").weight),
    ).toBe(65);

    expect(run("DELETE FROM basket_items WHERE index_id = ? AND ticker = ?", "idx-1", "6758.T")).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM basket_items").n)).toBe(1);

    // ON DELETE CASCADE: deleting the index must not leave orphaned rows.
    expect(run("DELETE FROM indices WHERE id = ?", "idx-1")).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM basket_items").n)).toBe(0);
  });
});

describe("rate_limits", () => {
  /**
   * The Worker's slot reservation (worker/internal-impl.ts checkRateLimit):
   * the first request inserts, later requests increment, an expired window is
   * reset on the spot, and a saturated window is a no-op reported as
   * `changes = 0`.
   */
  function reserveSlot(ip: string, endpoint: string, now: number, maxRequests: number): number {
    return run(
      "INSERT INTO rate_limits (ip, endpoint, request_count, window_start) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT(ip, endpoint) DO UPDATE SET " +
        "request_count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.request_count + 1 END, " +
        "window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END " +
        "WHERE rate_limits.window_start <= ? OR rate_limits.request_count < ?",
      ip,
      endpoint,
      now,
      now - RATE_LIMIT_WINDOW_SECONDS,
      now - RATE_LIMIT_WINDOW_SECONDS,
      now - RATE_LIMIT_WINDOW_SECONDS,
      maxRequests,
    );
  }

  it("upserts one row per (ip, endpoint) and refuses requests over the limit", () => {
    const ip = "203.0.113.7";
    const endpoint = "/api/auth/login";

    expect(reserveSlot(ip, endpoint, 1000, 3)).toBe(1);
    expect(Number(one("SELECT request_count FROM rate_limits").request_count)).toBe(1);

    expect(reserveSlot(ip, endpoint, 1001, 3)).toBe(1);
    expect(reserveSlot(ip, endpoint, 1002, 3)).toBe(1);
    expect(Number(one("SELECT request_count FROM rate_limits").request_count)).toBe(3);

    // Saturated window: the conditional update matches no row.
    expect(reserveSlot(ip, endpoint, 1003, 3)).toBe(0);
    expect(Number(one("SELECT request_count FROM rate_limits").request_count)).toBe(3);

    // A later request outside the window starts a fresh counter.
    const nextWindow = 1000 + RATE_LIMIT_WINDOW_SECONDS + 1;
    expect(reserveSlot(ip, endpoint, nextWindow, 3)).toBe(1);
    const row = one("SELECT request_count, window_start FROM rate_limits");
    expect(Number(row.request_count)).toBe(1);
    expect(Number(row.window_start)).toBe(nextWindow);

    // Another endpoint gets its own budget for the same IP.
    expect(reserveSlot(ip, "/api/sync-prices", 1003, 3)).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM rate_limits").n)).toBe(2);

    // The purge statement relies on window_start (idx_rate_limits_window_start).
    expect(run("DELETE FROM rate_limits WHERE window_start < ?", nextWindow + 1)).toBe(2);
    expect(Number(one("SELECT COUNT(*) AS n FROM rate_limits").n)).toBe(0);
  });
});

describe("admin_sessions", () => {
  it("accepts only unexpired sessions of an active admin account", () => {
    run(
      "INSERT INTO access_passwords (id, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
      "admin-1",
      "admin",
      "pbkdf2-hash",
      1000,
    );
    const insertSession =
      "INSERT OR REPLACE INTO admin_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)";
    run(insertSession, "hash-live", "admin-1", 1000, 2000);
    run(insertSession, "hash-expired", "admin-1", 1000, 1000);

    const lookup =
      "SELECT s.account_id FROM admin_sessions s JOIN access_passwords p ON p.id = s.account_id " +
      "WHERE s.token_hash = ? AND s.expires_at > ? AND p.role = 'admin' AND p.is_active = 1";
    expect(db.prepare(lookup).get("hash-live", 1500)?.account_id).toBe("admin-1");
    expect(db.prepare(lookup).get("hash-expired", 1500)).toBeUndefined();
    expect(db.prepare(lookup).get("hash-live", 2000)).toBeUndefined();

    // Expiry purge used by purgeExpiredSecurityRows().
    expect(run("DELETE FROM admin_sessions WHERE expires_at <= ?", 1500)).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM admin_sessions").n)).toBe(1);

    // Rotation replaces the row instead of accumulating tokens.
    run(insertSession, "hash-live", "admin-1", 1500, 2500);
    expect(Number(one("SELECT expires_at FROM admin_sessions WHERE token_hash = ?", "hash-live").expires_at)).toBe(2500);
    expect(Number(one("SELECT COUNT(*) AS n FROM admin_sessions").n)).toBe(1);

    // Deleting an account revokes every session it owns.
    run("DELETE FROM access_passwords WHERE id = ?", "admin-1");
    expect(run("DELETE FROM admin_sessions WHERE account_id = ?", "admin-1")).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM admin_sessions").n)).toBe(0);
  });
});

describe("sync_quota", () => {
  it("accumulates the per-IP daily ticker budget and keeps days apart", () => {
    const upsert =
      "INSERT INTO sync_quota (ip, day, tickers) VALUES (?, ?, ?) " +
      "ON CONFLICT(ip, day) DO UPDATE SET tickers = sync_quota.tickers + excluded.tickers";

    expect(run(upsert, "203.0.113.7", "2026-10-20", 12)).toBe(1);
    expect(run(upsert, "203.0.113.7", "2026-10-20", 3)).toBe(1);
    expect(
      Number(one("SELECT tickers FROM sync_quota WHERE ip = ? AND day = ?", "203.0.113.7", "2026-10-20").tickers),
    ).toBe(15);

    run(upsert, "203.0.113.7", "2026-10-21", 5);
    expect(
      Number(one("SELECT tickers FROM sync_quota WHERE ip = ? AND day = ?", "203.0.113.7", "2026-10-21").tickers),
    ).toBe(5);

    run(upsert, "198.51.100.9", "2026-10-20", 7);
    // One row per (ip, day): three rows, never a duplicate pair.
    expect(Number(one("SELECT COUNT(*) AS n FROM sync_quota").n)).toBe(3);
    expect(Number(one("SELECT SUM(tickers) AS total FROM sync_quota").total)).toBe(27);
  });
});

describe("quote caches", () => {
  it("keeps the series cache, price history and sync markers at one row per key", () => {
    const insertSeries = "INSERT OR REPLACE INTO stock_series (ticker, prices, updated_at) VALUES (?, ?, ?)";
    expect(run(insertSeries, "7203.T", '{"closes":[2500]}', 1000)).toBe(1);
    expect(run(insertSeries, "7203.T", '{"closes":[2500,2510]}', 2000)).toBe(1);
    const series = one("SELECT prices, updated_at FROM stock_series WHERE ticker = ?", "7203.T");
    expect(series.updated_at).toBe(2000);
    expect(Number(one("SELECT COUNT(*) AS n FROM stock_series").n)).toBe(1);

    const insertPrice = "INSERT OR REPLACE INTO stock_prices (ticker, date, price) VALUES (?, ?, ?)";
    run(insertPrice, "7203.T", "2026-10-19", 2500);
    run(insertPrice, "7203.T", "2026-10-20", 2510);
    expect(run(insertPrice, "7203.T", "2026-10-20", 2520)).toBe(1);
    expect(Number(one("SELECT COUNT(*) AS n FROM stock_prices WHERE ticker = ?", "7203.T").n)).toBe(2);
    expect(Number(one("SELECT price FROM stock_prices WHERE ticker = ? AND date = ?", "7203.T", "2026-10-20").price)).toBe(2520);

    const insertLog = "INSERT OR REPLACE INTO sync_logs (ticker, last_synced_at) VALUES (?, ?)";
    run(insertLog, "7203.T", 3000);
    expect(run(insertLog, "7203.T", 4000)).toBe(1);
    expect(Number(one("SELECT last_synced_at FROM sync_logs WHERE ticker = ?", "7203.T").last_synced_at)).toBe(4000);
    expect(Number(one("SELECT COUNT(*) AS n FROM sync_logs").n)).toBe(1);
  });
});

describe("schema.migration.sql converges a legacy database", () => {
  function columns(target: DatabaseSync, table: string): string[] {
    return target
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String(row.name))
      .sort();
  }

  function namedIndexes(target: DatabaseSync): Set<string> {
    return new Set(
      target
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
        .all()
        .map((row) => String(row.name)),
    );
  }

  it("reaches the same columns and indexes as schema.sql", () => {
    const legacy = new sqlite.DatabaseSync(":memory:");
    try {
      legacy.exec(`
        CREATE TABLE indices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          base_value REAL DEFAULT 1000
        );
        CREATE TABLE basket_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          index_id TEXT NOT NULL,
          ticker TEXT NOT NULL,
          name TEXT NOT NULL,
          weight REAL NOT NULL,
          theme TEXT
        );
        CREATE TABLE access_passwords (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          max_stocks INTEGER DEFAULT 10,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER
        );
        CREATE INDEX idx_basket_items_index_id ON basket_items(index_id);
        CREATE INDEX idx_access_passwords_hash ON access_passwords(password_hash);
      `);

      legacy.exec(migrationSql);

      for (const table of EXPECTED_TABLES) {
        expect(columns(legacy, table), `column set of ${table}`).toEqual(columns(db, table));
      }
      expect(namedIndexes(legacy)).toEqual(namedIndexes(db));
    } finally {
      legacy.close();
    }
  });
});
