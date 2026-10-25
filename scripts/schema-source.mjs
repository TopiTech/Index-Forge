/**
 * Canonical schema derivation.
 *
 * `schema.sql` is the single source of truth for the D1 definition. This module
 * parses it and projects it into the two artifacts that cannot read it at
 * runtime:
 *
 *   - `worker/schemaSteps.generated.ts` — the Worker's provisioning steps
 *     (written by scripts/generate-schema-steps.mjs).
 *   - `schema.migration.sql` — the one-shot legacy migration.
 *
 * Nothing here names a table, column or index: adding one to schema.sql is
 * enough, and src/lib/schemaSingleSource.test.ts fails if a generated artifact
 * is edited instead (or left stale).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Marks a column that older databases may be missing (SQLite has no ADD COLUMN IF NOT EXISTS). */
export const LEGACY_COLUMN_MARKER = "@legacy-add";

/**
 * Vitest's jsdom environment evaluates this module with an `import.meta.url`
 * that is not a file URL, so a bare `fileURLToPath(import.meta.url)` throws at
 * import time in those suites. Fall back to the repository root, which is the
 * working directory for both the CLI and the test runner.
 */
function schemaPath() {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl === "string" && moduleUrl.startsWith("file:")) {
    return fileURLToPath(new URL("../schema.sql", moduleUrl));
  }
  return resolve(process.cwd(), "schema.sql");
}

export const OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL =
  "UPDATE indices SET owner_token_issued_at = CAST(strftime('%s','now') AS INTEGER) WHERE owner_token_issued_at IS NULL AND owner_token_hash IS NOT NULL";

/**
 * Indexes that used to be created and are now covered by another constraint.
 * This is cleanup of deployed leftovers, not part of the current definition.
 */
export const LEGACY_INDEX_CLEANUP = [
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

export function readSchemaSql() {
  return readFileSync(schemaPath(), "utf8");
}

/**
 * Replaces `--` comment bodies with spaces while preserving offsets and
 * newlines, so a cleaned slice can still be used to index into the raw text.
 * schema.sql contains no `--` inside string literals; the quoted literal
 * handling below only needs to keep statement splitting out of `'...'`.
 */
function blankComments(sql) {
  return sql.replace(/--[^\n]*/g, (match) => " ".repeat(match.length));
}

function splitStatements(raw) {
  const clean = blankComments(raw);
  const statements = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (ch === ";" && depth === 0) {
      statements.push({ raw: raw.slice(start, i), clean: clean.slice(start, i) });
      start = i + 1;
    }
  }
  statements.push({ raw: raw.slice(start), clean: clean.slice(start) });

  return statements.flatMap(({ raw: rawStatement, clean: cleanStatement }) => {
    const trimmed = cleanStatement.trim();
    if (!trimmed) return [];
    const startOffset = cleanStatement.indexOf(trimmed);
    const endOffset = startOffset + trimmed.length;
    return [{ raw: rawStatement.slice(startOffset, endOffset), clean: trimmed }];
  });
}

/** Splits a parenthesised body on commas that are not nested in a constraint. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  parts.push([start, body.length]);
  return parts;
}

const CONSTRAINT_PREFIX = /^(FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY|CHECK|CONSTRAINT)\b/i;
const COLUMN_NAME = /^([A-Za-z_][A-Za-z0-9_]*)\s+/;

function parseTable(statement) {
  const open = statement.clean.indexOf("(");
  const close = statement.clean.lastIndexOf(")");
  if (open < 0 || close <= open) {
    throw new Error(`schema.sql: table statement without a column list: ${statement.clean}`);
  }
  const bodyStart = open + 1;
  const columns = [];
  for (const [from, to] of splitTopLevel(statement.clean.slice(bodyStart, close))) {
    const chunk = statement.clean.slice(bodyStart + from, bodyStart + to);
    const definition = chunk.replace(/\s+/g, " ").trim();
    if (!definition) continue;
    if (CONSTRAINT_PREFIX.test(definition)) continue;
    const name = COLUMN_NAME.exec(definition)?.[1];
    if (!name) {
      throw new Error(`schema.sql: unrecognised column definition: ${definition}`);
    }
    const rawChunk = statement.raw.slice(bodyStart + from, bodyStart + to);
    columns.push({
      name,
      definition,
      legacyAdd: rawChunk.includes(LEGACY_COLUMN_MARKER),
    });
  }
  if (columns.length === 0) {
    throw new Error("schema.sql: table without columns");
  }
  return { columns };
}

const CREATE_TABLE =
  /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i;
const CREATE_INDEX =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+/i;

/**
 * Parses the canonical DDL into tables (with columns) and indexes, in file
 * order. Throws on any statement it does not understand so a future construct
 * cannot silently drop out of the generated artifacts.
 */
export function parseSchema(sql) {
  const tables = [];
  const indexes = [];
  for (const statement of splitStatements(sql)) {
    const tableName = CREATE_TABLE.exec(statement.clean)?.[1];
    if (tableName) {
      tables.push({ name: tableName, sql: statement.raw, ...parseTable(statement) });
      continue;
    }
    const indexName = CREATE_INDEX.exec(statement.clean)?.[1];
    if (indexName) {
      indexes.push({ name: indexName, sql: statement.raw });
      continue;
    }
    throw new Error(`schema.sql: unsupported statement: ${statement.clean.slice(0, 80)}`);
  }
  return { tables, indexes };
}

function legacyColumnSteps(schema) {
  const steps = [];
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.legacyAdd) continue;
      steps.push({
        table: table.name,
        name: column.name,
        sql: `ALTER TABLE ${table.name} ADD COLUMN ${column.definition}`,
      });
    }
  }
  return steps;
}

/** Steps the Worker needs to provision a database that predates a table/index/column. */
export function buildSchemaSteps(sql) {
  const schema = parseSchema(sql);
  const steps = [];
  for (const table of schema.tables) {
    steps.push({ existing: { kind: "table", name: table.name }, sql: table.sql });
  }
  for (const column of legacyColumnSteps(schema)) {
    steps.push({ column: { table: column.table, name: column.name }, sql: column.sql });
  }
  for (const index of schema.indexes) {
    steps.push({ existing: { kind: "index", name: index.name }, sql: index.sql });
  }
  return steps;
}

/** Steps `scripts/apply-migrations.mjs` probes and applies. */
export function buildMigrationSteps(sql) {
  const schema = parseSchema(sql);
  return [
    ...schema.tables.map((table) => ({ type: "table", name: table.name, sql: table.sql })),
    ...legacyColumnSteps(schema).map((column) => ({
      type: "column",
      table: column.table,
      name: column.name,
      sql: column.sql,
    })),
    ...schema.indexes.map((index) => ({ type: "index", name: index.name, sql: index.sql })),
    ...LEGACY_INDEX_CLEANUP,
  ];
}

const WORKER_MODULE_HEADER = `/**
 * AUTO-GENERATED from schema.sql by \`npm run db:schema:generate\`.
 *
 * Do not edit this file. It is a projection of the canonical definition in
 * schema.sql, and src/lib/schemaSingleSource.test.ts fails when the two drift.
 * The projection exists because the Worker is bundled for workerd and cannot
 * read schema.sql at runtime.
 */`;

const LEGACY_MIGRATION_HEADER = `-- Migration: bring legacy databases up to the canonical schema.sql revision.
--
-- GENERATED FILE — do not edit. \`npm run db:schema:generate\` rewrites it from
-- schema.sql, which is the single source of truth.
--
-- RUN ORDER AND SAFETY:
--   1. Recommended: \`npm run db:migrate:columns\` (or
--      \`db:migrate:columns:local\`), which runs scripts/apply-migrations.mjs.
--      It probes sqlite_master and PRAGMA table_info and applies only what is
--      missing, so it is safe to re-run and safe on an already provisioned
--      database.
--   2. This file is for a legacy database that predates the current columns.
--      Run it EXACTLY ONCE, BEFORE re-applying schema.sql. Its CREATE/INDEX/DROP
--      statements are idempotent, but SQLite has no ADD COLUMN IF NOT EXISTS, so
--      a second run fails on the first column that already exists.
--   3. \`schema.sql\` alone is for a fresh deployment: it already contains every
--      column below.
--
-- Legacy releases stored issued passwords in plain text. Application code never
-- reads or writes \`plain_password\`, so scrubbing is hygiene, not functional.
-- Run it manually only when PRAGMA table_info(access_passwords) shows the
-- column (it is absent from schema.sql, so it cannot be part of this file):
--   UPDATE access_passwords SET plain_password = NULL WHERE plain_password IS NOT NULL;`;

function escapeTemplateLiteral(value) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** Renders the Worker's generated provisioning module. */
export function renderWorkerStepsModule(sql) {
  const steps = buildSchemaSteps(sql);
  const probedTables = [
    ...new Set(steps.flatMap((step) => (step.column ? [step.column.table] : []))),
  ];
  const entries = steps
    .map((step) => {
      const fields = [];
      if (step.existing) {
        fields.push(`existing: { kind: "${step.existing.kind}", name: "${step.existing.name}" }`);
      }
      if (step.column) {
        fields.push(`column: { table: "${step.column.table}", name: "${step.column.name}" }`);
      }
      fields.push(`sql: \`${escapeTemplateLiteral(step.sql)}\``);
      return `  {\n    ${fields.join(",\n    ")},\n  },`;
    })
    .join("\n");

  return `${WORKER_MODULE_HEADER}

export interface SchemaStep {
  /** sqlite_master object that makes this step unnecessary (table or index). */
  existing?: { kind: "table" | "index"; name: string };
  /** Column that makes this step unnecessary; skipped when its table is absent. */
  column?: { table: string; name: string };
  sql: string;
}

export const OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL =
  ${JSON.stringify(OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL)};

/** Tables whose columns \`probeSchemaObjects\` has to inspect. Derived from the column steps. */
export const PROBED_COLUMN_TABLES = [${probedTables
    .map((table) => JSON.stringify(table))
    .join(", ")}] as const;

export const REQUIRED_SCHEMA_STEPS: SchemaStep[] = [
${entries}
];
`;
}

/** Renders the one-shot legacy migration from the canonical definition. */
export function renderLegacyMigration(sql) {
  const schema = parseSchema(sql);
  const semicolon = (statement) => `${statement.trim()};`;
  const sections = [
    LEGACY_MIGRATION_HEADER,
    [
      "-- Tables (idempotent: a database created by an older release may be missing later additions).",
      ...schema.tables.map((table) => semicolon(table.sql)),
    ].join("\n\n"),
    [
      "-- Columns added after the first release. Run this section exactly once.",
      ...legacyColumnSteps(schema).map((column) => semicolon(column.sql)),
    ].join("\n\n"),
    [
      "-- Indexes (idempotent).",
      ...schema.indexes.map((index) => semicolon(index.sql)),
    ].join("\n\n"),
    [
      "-- Obsolete indexes replaced by UNIQUE(index_id, ticker) / never looked up.",
      ...LEGACY_INDEX_CLEANUP.map((step) => semicolon(step.sql)),
    ].join("\n\n"),
    [
      "-- Grandfathered owner tokens: record the migration time so those rows enter",
      "-- the normal 90-day rotation window instead of an eternal exemption.",
      semicolon(OWNER_TOKEN_ISSUED_AT_BACKFILL_SQL),
    ].join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}
