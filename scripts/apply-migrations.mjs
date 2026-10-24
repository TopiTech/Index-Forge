/**
 * Idempotent D1 Database Migration Runner
 *
 * Checks sqlite_master and PRAGMA table_info before applying DDL statements,
 * so ALTER TABLE ADD COLUMN and CREATE TABLE/INDEX statements never fail
 * with "duplicate column name" or "table already exists".
 *
 * Usage:
 *   node scripts/apply-migrations.mjs [--local | --remote]
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonical required schema steps (mirrors Worker's REQUIRED_SCHEMA_STEPS).
 */
export const REQUIRED_MIGRATION_STEPS = [
  {
    type: "table",
    name: "indices",
    sql: `CREATE TABLE IF NOT EXISTS indices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        base_value REAL DEFAULT 1000,
        sort_order INTEGER DEFAULT 99,
        owner_token_hash TEXT,
        owner_token_issued_at INTEGER,
        creator_id TEXT,
        created_at INTEGER
      )`,
  },
  {
    type: "table",
    name: "basket_items",
    sql: `CREATE TABLE IF NOT EXISTS basket_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        index_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        weight REAL NOT NULL,
        theme TEXT,
        FOREIGN KEY (index_id) REFERENCES indices (id) ON DELETE CASCADE,
        UNIQUE(index_id, ticker)
      )`,
  },
  {
    type: "table",
    name: "stock_prices",
    sql: `CREATE TABLE IF NOT EXISTS stock_prices (
        ticker TEXT NOT NULL,
        date TEXT NOT NULL,
        price REAL NOT NULL,
        PRIMARY KEY (ticker, date)
      )`,
  },
  {
    type: "table",
    name: "access_passwords",
    sql: `CREATE TABLE IF NOT EXISTS access_passwords (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        max_stocks INTEGER DEFAULT 10,
        max_indices INTEGER DEFAULT NULL,
        secret_code_hash TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )`,
  },
  {
    type: "column",
    table: "access_passwords",
    name: "max_indices",
    sql: "ALTER TABLE access_passwords ADD COLUMN max_indices INTEGER DEFAULT NULL",
  },
  {
    type: "column",
    table: "access_passwords",
    name: "secret_code_hash",
    sql: "ALTER TABLE access_passwords ADD COLUMN secret_code_hash TEXT",
  },
  {
    type: "table",
    name: "admin_login_attempts",
    sql: `CREATE TABLE IF NOT EXISTS admin_login_attempts (
          ip TEXT PRIMARY KEY,
          failed_count INTEGER NOT NULL DEFAULT 0,
          last_failed_at INTEGER NOT NULL,
          locked_until INTEGER NOT NULL DEFAULT 0
        )`,
  },
  {
    type: "table",
    name: "admin_sessions",
    sql: `CREATE TABLE IF NOT EXISTS admin_sessions (
          token_hash TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
  },
  {
    type: "table",
    name: "benchmark_cache",
    sql: `CREATE TABLE IF NOT EXISTS benchmark_cache (
          symbol TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        )`,
  },
  {
    type: "table",
    name: "rate_limits",
    sql: `CREATE TABLE IF NOT EXISTS rate_limits (
          ip TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          request_count INTEGER DEFAULT 1,
          window_start INTEGER NOT NULL,
          PRIMARY KEY (ip, endpoint)
        )`,
  },
  {
    type: "index",
    name: "idx_rate_limits_window_start",
    sql: "CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start)",
  },
  {
    type: "table",
    name: "sync_logs",
    sql: `CREATE TABLE IF NOT EXISTS sync_logs (
          ticker TEXT PRIMARY KEY,
          last_synced_at INTEGER NOT NULL
        )`,
  },
  {
    type: "table",
    name: "snapshot_cache",
    sql: `CREATE TABLE IF NOT EXISTS snapshot_cache (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        )`,
  },
  {
    type: "table",
    name: "stock_series",
    sql: `CREATE TABLE IF NOT EXISTS stock_series (
          ticker TEXT PRIMARY KEY,
          prices TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
  },
  {
    type: "table",
    name: "sync_quota",
    sql: `CREATE TABLE IF NOT EXISTS sync_quota (
          ip TEXT NOT NULL,
          day TEXT NOT NULL,
          tickers INTEGER NOT NULL,
          PRIMARY KEY (ip, day)
        )`,
  },
  {
    type: "index",
    name: "idx_sync_quota_day",
    sql: "CREATE INDEX IF NOT EXISTS idx_sync_quota_day ON sync_quota(day)",
  },
  {
    type: "column",
    table: "indices",
    name: "owner_token_hash",
    sql: "ALTER TABLE indices ADD COLUMN owner_token_hash TEXT",
  },
  {
    type: "column",
    table: "indices",
    name: "owner_token_issued_at",
    sql: "ALTER TABLE indices ADD COLUMN owner_token_issued_at INTEGER",
  },
  {
    type: "column",
    table: "indices",
    name: "created_at",
    sql: "ALTER TABLE indices ADD COLUMN created_at INTEGER",
  },
  {
    type: "column",
    table: "indices",
    name: "creator_id",
    sql: "ALTER TABLE indices ADD COLUMN creator_id TEXT",
  },
  {
    type: "column",
    table: "indices",
    name: "sort_order",
    sql: "ALTER TABLE indices ADD COLUMN sort_order INTEGER DEFAULT 99",
  },
  {
    type: "index",
    name: "idx_indices_creator_id",
    sql: "CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id)",
  },
  {
    type: "index",
    name: "idx_admin_sessions_account_id",
    sql: "CREATE INDEX IF NOT EXISTS idx_admin_sessions_account_id ON admin_sessions(account_id)",
  },
  {
    type: "index",
    name: "idx_admin_sessions_expires_at",
    sql: "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at)",
  },
  {
    type: "index",
    name: "idx_access_passwords_created_at",
    sql: "CREATE INDEX IF NOT EXISTS idx_access_passwords_created_at ON access_passwords(created_at)",
  },
  {
    type: "index",
    name: "idx_admin_login_attempts_purge",
    sql: "CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_purge ON admin_login_attempts(last_failed_at, locked_until)",
  },
  {
    type: "drop_index",
    name: "idx_basket_items_index_id",
    sql: "DROP INDEX IF EXISTS idx_basket_items_index_id",
  },
  {
    type: "drop_index",
    name: "idx_access_passwords_hash",
    sql: "DROP INDEX IF EXISTS idx_access_passwords_hash",
  },
];

export const OWNER_TOKEN_BACKFILL_SQL =
  "UPDATE indices SET owner_token_issued_at = CAST(strftime('%s','now') AS INTEGER) WHERE owner_token_issued_at IS NULL AND owner_token_hash IS NOT NULL";

/**
 * Filter required steps to find only those not yet applied to the database.
 */
export function computePendingMigrations(probe, steps = REQUIRED_MIGRATION_STEPS) {
  const pending = [];
  const { tables = new Set(), indexes = new Set(), columns = new Map() } = probe || {};

  for (const step of steps) {
    if (step.type === "table") {
      if (!tables.has(step.name)) {
        pending.push(step);
      }
    } else if (step.type === "index") {
      if (!indexes.has(step.name)) {
        pending.push(step);
      }
    } else if (step.type === "drop_index") {
      if (indexes.has(step.name)) {
        pending.push(step);
      }
    } else if (step.type === "column") {
      // If parent table does not exist yet, CREATE TABLE step handles all columns
      if (!tables.has(step.table)) continue;
      const tableColumns = columns.get(step.table) || new Set();
      if (!tableColumns.has(step.name)) {
        pending.push(step);
      }
    }
  }

  return pending;
}

/**
 * Parses Wrangler JSON output into an array of result objects.
 */
export function parseWranglerJson(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0]?.results)) {
      return parsed[0].results;
    }
    if (parsed && Array.isArray(parsed.results)) {
      return parsed.results;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Probe current schema state using wrangler CLI.
 */
export function probeDatabase(targetFlag, configPath = "wrangler.local.jsonc", dbName = "original-stock-index-db") {
  const masterCmd = `SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')`;
  const masterOutput = execWrangler(targetFlag, configPath, dbName, masterCmd);
  const masterRows = parseWranglerJson(masterOutput);

  const tables = new Set();
  const indexes = new Set();
  for (const row of masterRows) {
    if (typeof row?.name === "string") {
      if (row.type === "table") tables.add(row.name);
      else if (row.type === "index") indexes.add(row.name);
    }
  }

  const columns = new Map();
  const tablesToCheck = Array.from(
    new Set(
      REQUIRED_MIGRATION_STEPS.filter((s) => s.type === "column" && s.table).map((s) => s.table),
    ),
  );
  for (const table of tablesToCheck) {
    if (!tables.has(table)) continue;
    const infoCmd = `PRAGMA table_info(${table})`;
    const infoOutput = execWrangler(targetFlag, configPath, dbName, infoCmd);
    const infoRows = parseWranglerJson(infoOutput);
    const colSet = new Set();
    for (const row of infoRows) {
      if (typeof row?.name === "string") colSet.add(row.name);
    }
    columns.set(table, colSet);
  }

  return { tables, indexes, columns };
}

function getWranglerRunner() {
  const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
  const localWranglerBin = resolve(repoRoot, "node_modules/wrangler/bin/wrangler.js");
  if (existsSync(localWranglerBin)) {
    return {
      cmd: process.execPath,
      baseArgs: [localWranglerBin],
      options: { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    };
  }

  // Fallback to npx
  const isWindows = process.platform === "win32";
  return {
    cmd: isWindows ? "npx.cmd" : "npx",
    baseArgs: ["wrangler"],
    options: {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: isWindows,
    },
  };
}

function execWrangler(targetFlag, configPath, dbName, sql) {
  const runner = getWranglerRunner();
  const args = [
    ...runner.baseArgs,
    "d1",
    "execute",
    dbName,
    targetFlag,
    "--config",
    configPath,
    "--command",
    sql,
    "--json",
  ];

  try {
    return execFileSync(runner.cmd, args, runner.options);
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : "";
    const stdout = err.stdout ? String(err.stdout) : "";
    throw new Error(`Wrangler execution failed for [${sql}]: ${stderr || stdout || err.message}`);
  }
}

export function runMigration(targetFlag = "--local", configPath = "wrangler.local.jsonc", dbName = "original-stock-index-db") {
  console.log(`\n🔍 Probing D1 database (${targetFlag}, config: ${configPath})...`);
  const probe = probeDatabase(targetFlag, configPath, dbName);

  console.log(`   Found ${probe.tables.size} tables, ${probe.indexes.size} indexes.`);
  const pending = computePendingMigrations(probe);

  if (pending.length === 0) {
    console.log("✅ Database schema is already up to date. No migration needed.\n");
  } else {
    console.log(`\n🚀 Applying ${pending.length} pending migration step(s)...`);
    for (const step of pending) {
      const desc =
        step.type === "column"
          ? `Column ${step.table}.${step.name}`
          : step.type === "drop_index"
            ? `DROP INDEX ${step.name}`
            : `${step.type.toUpperCase()} ${step.name}`;
      process.stdout.write(`   Applying ${desc}... `);
      try {
        execWrangler(targetFlag, configPath, dbName, step.sql);
        console.log("OK");
      } catch (err) {
        if (/already exists|duplicate column|no such index/i.test(err.message)) {
          console.log("ALREADY APPLIED / SKIPPED");
        } else {
          console.log("FAILED");
          throw err;
        }
      }
    }
    console.log("✅ All pending migrations applied successfully.\n");
  }

  // Backfill owner_token_issued_at if table and column are present (or were just applied)
  const indicesCols = probe.columns.get("indices");
  const hasIndicesTable =
    probe.tables.has("indices") || pending.some((s) => s.type === "table" && s.name === "indices");
  const hasOwnerTokenHash =
    (indicesCols && indicesCols.has("owner_token_hash")) ||
    pending.some((s) => s.type === "column" && s.table === "indices" && s.name === "owner_token_hash");

  if (hasIndicesTable && hasOwnerTokenHash) {
    try {
      execWrangler(targetFlag, configPath, dbName, OWNER_TOKEN_BACKFILL_SQL);
      console.log("   Backfilled owner_token_issued_at timestamp for grandfathered rows.");
    } catch {
      // Best effort backfill
    }
  }

  return { appliedCount: pending.length, steps: pending };
}

// CLI entry point
const isDirectCall =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectCall) {
  const targetFlag = process.argv.includes("--remote") ? "--remote" : "--local";
  try {
    runMigration(targetFlag);
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  }
}
