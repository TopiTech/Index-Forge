/**
 * Idempotent D1 Database Migration Runner
 *
 * The steps are derived from schema.sql (the single source of truth).
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
import {
  buildMigrationSteps,
  OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL,
  readSchemaSql,
} from "./schema-source.mjs";

/**
 * Steps are derived from schema.sql by scripts/schema-source.mjs so the
 * operational migration path cannot drift from the canonical definition.
 */
export const REQUIRED_MIGRATION_STEPS = buildMigrationSteps(readSchemaSql());

export const OWNER_TOKEN_BACKFILL_SQL = OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL;

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
 *
 * Fail closed (I2): an unparsable or unexpected payload must not be treated as
 * "no schema objects" -- that would make the migration runner recreate DDL or
 * silently skip the owner-token backfill based on a broken probe.
 */
export function parseWranglerJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Invalid Wrangler JSON output: ${err.message}`);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && Array.isArray(parsed[0]?.results)) {
      return parsed[0].results;
    }
    throw new Error("Unexpected Wrangler JSON output: no results array");
  }
  if (parsed && Array.isArray(parsed.results)) {
    return parsed.results;
  }
  throw new Error("Unexpected Wrangler JSON output: no results array");
}

/**
 * Probe current schema state using wrangler CLI.
 *
 * `exec` is injectable for tests and defaults to the real Wrangler runner.
 */
export function probeDatabase(targetFlag, configPath = "wrangler.local.jsonc", dbName = "original-stock-index-db", exec = execWrangler) {
  const masterCmd = `SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')`;
  const masterOutput = exec(targetFlag, configPath, dbName, masterCmd);
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
    const infoOutput = exec(targetFlag, configPath, dbName, infoCmd);
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

export function runMigration(targetFlag = "--local", configPath = "wrangler.local.jsonc", dbName = "original-stock-index-db", exec = execWrangler) {
  console.log(`\n🔍 Probing D1 database (${targetFlag}, config: ${configPath})...`);
  const probe = probeDatabase(targetFlag, configPath, dbName, exec);

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
        exec(targetFlag, configPath, dbName, step.sql);
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
  const hasOwnerTokenIssuedAt =
    (indicesCols && indicesCols.has("owner_token_issued_at")) ||
    pending.some((s) => s.type === "column" && s.table === "indices" && s.name === "owner_token_issued_at");

  if (hasIndicesTable && hasOwnerTokenHash && hasOwnerTokenIssuedAt) {
    try {
      exec(targetFlag, configPath, dbName, OWNER_TOKEN_BACKFILL_SQL);
      console.log("   Backfilled owner_token_issued_at timestamp for grandfathered rows.");
    } catch (err) {
      // I3: the backfill is idempotent, so a re-run is the recovery path. It
      // must still be fatal -- a warning-only miss leaves legacy owner tokens
      // exempt from rotation indefinitely and exits 0 on a broken database.
      throw new Error(
        `owner_token_issued_at backfill failed: ${err.message}. ` +
          "The statement is idempotent; re-run the migration (npm run db:migrate:columns[:local]) " +
          "after resolving the error to complete it.",
      );
    }
  }

  return { appliedCount: pending.length, steps: pending };
}

/**
 * Parse CLI arguments for migration runner.
 *
 * Supports:
 *   --remote / --local
 *   --config <path> or --config=<path>
 *   --database <name> or --database=<name>
 *   --db <name> or --db=<name>
 *
 * Unspecified options fall back to the backward-compatible defaults:
 *   targetFlag: "--local"
 *   configPath: "wrangler.local.jsonc"
 *   dbName: "original-stock-index-db"
 *
 * I7: unknown flags and missing values throw instead of being silently
 * ignored, so a typo can no longer run a migration against the wrong target.
 */
export function parseCliArgs(args = process.argv.slice(2)) {
  let targetFlag = "--local";
  let configPath = "wrangler.local.jsonc";
  let dbName = "original-stock-index-db";

  const requireValue = (flag, value) => {
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--remote") {
      targetFlag = "--remote";
    } else if (arg === "--local") {
      targetFlag = "--local";
    } else if (arg === "--config") {
      configPath = requireValue("--config", args[++i]);
    } else if (arg.startsWith("--config=")) {
      configPath = requireValue("--config", arg.slice("--config=".length));
    } else if (arg === "--database" || arg === "--db") {
      dbName = requireValue(arg, args[++i]);
    } else if (arg.startsWith("--database=")) {
      dbName = requireValue("--database", arg.slice("--database=".length));
    } else if (arg.startsWith("--db=")) {
      dbName = requireValue("--db", arg.slice("--db=".length));
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  return { targetFlag, configPath, dbName };
}

// CLI entry point
const isDirectCall =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectCall) {
  try {
    const { targetFlag, configPath, dbName } = parseCliArgs(process.argv.slice(2));
    runMigration(targetFlag, configPath, dbName);
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  }
}
