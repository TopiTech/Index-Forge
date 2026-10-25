// @vitest-environment node
/**
 * D1: `schema.sql` is the single source of truth for the D1 definition.
 *
 * The Worker's provisioning steps (worker/schemaSteps.generated.ts) and the
 * legacy migration (schema.migration.sql) are generated from it. This test
 * re-parses the canonical file on its own and compares it with the committed
 * artifacts, so it fails when:
 *
 *   - schema.sql gains/loses a table, column or index without regenerating, or
 *   - a generated artifact is edited to something schema.sql does not define.
 *
 * The legacy ALTER steps must stay limited to the columns marked
 * `-- @legacy-add`: an already provisioned database must never be asked to
 * re-add a column it already has.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REQUIRED_SCHEMA_STEPS } from "../../worker/internal";
import {
  REQUIRED_MIGRATION_STEPS,
  computePendingMigrations,
} from "../../scripts/apply-migrations.mjs";

const repoRoot = resolve(__dirname, "../..");
const schemaSql = readFileSync(resolve(repoRoot, "schema.sql"), "utf8");
const migrationSql = readFileSync(resolve(repoRoot, "schema.migration.sql"), "utf8");
const schemaDevSql = readFileSync(resolve(repoRoot, "schema.dev.sql"), "utf8");

const LEGACY_MARKER = "@legacy-add";
const CONSTRAINT_PREFIX = /^(FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY|CHECK|CONSTRAINT)\b/i;
const CREATE_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/i;
const CREATE_INDEX = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+/i;

interface ExpectedColumn {
  name: string;
  definition: string;
  legacyAdd: boolean;
}

interface ExpectedTable {
  name: string;
  /** Raw CREATE TABLE text, trimmed, without the trailing semicolon. */
  sql: string;
  columns: ExpectedColumn[];
}

interface ExpectedSchema {
  tables: ExpectedTable[];
  indexes: { name: string; sql: string }[];
}

/** Blank out `--` comments, preserving offsets so cleaned text indexes raw text. */
function blankComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, (match) => " ".repeat(match.length));
}

function splitStatements(raw: string): { raw: string; clean: string }[] {
  const clean = blankComments(raw);
  const pieces: { raw: string; clean: string }[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "(") depth += 1;
    else if (clean[i] === ")") depth -= 1;
    else if (clean[i] === ";" && depth === 0) {
      pieces.push({ raw: raw.slice(start, i), clean: clean.slice(start, i) });
      start = i + 1;
    }
  }
  pieces.push({ raw: raw.slice(start), clean: clean.slice(start) });

  return pieces.flatMap(({ raw: rawPiece, clean: cleanPiece }) => {
    const trimmed = cleanPiece.trim();
    if (!trimmed) return [];
    const from = cleanPiece.indexOf(trimmed);
    return [{ raw: rawPiece.slice(from, from + trimmed.length), clean: trimmed }];
  });
}

function splitTopLevel(body: string): [number, number][] {
  const parts: [number, number][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") depth -= 1;
    else if (body[i] === "," && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  parts.push([start, body.length]);
  return parts;
}

function parseColumns(raw: string, clean: string): ExpectedColumn[] {
  const open = clean.indexOf("(");
  const close = clean.lastIndexOf(")");
  const columns: ExpectedColumn[] = [];
  for (const [from, to] of splitTopLevel(clean.slice(open + 1, close))) {
    const definition = clean
      .slice(open + 1 + from, open + 1 + to)
      .replace(/\s+/g, " ")
      .trim();
    if (!definition || CONSTRAINT_PREFIX.test(definition)) continue;
    const name = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(definition)?.[1];
    if (!name) throw new Error(`unrecognised column: ${definition}`);
    columns.push({
      name,
      definition,
      legacyAdd: raw.slice(open + 1 + from, open + 1 + to).includes(LEGACY_MARKER),
    });
  }
  return columns;
}

function parseExpected(sql: string): ExpectedSchema {
  const schema: ExpectedSchema = { tables: [], indexes: [] };
  for (const statement of splitStatements(sql)) {
    const table = CREATE_TABLE.exec(statement.clean)?.[1];
    if (table) {
      schema.tables.push({
        name: table,
        sql: statement.raw,
        columns: parseColumns(statement.raw, statement.clean),
      });
      continue;
    }
    const index = CREATE_INDEX.exec(statement.clean)?.[1];
    if (index) {
      schema.indexes.push({ name: index, sql: statement.raw });
      continue;
    }
    throw new Error(`unexpected statement: ${statement.clean.slice(0, 60)}`);
  }
  return schema;
}

const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim();

interface WorkerStep {
  existing?: { kind: "table" | "index"; name: string };
  column?: { table: string; name: string };
  sql: string;
}

interface MigrationStep {
  type: string;
  name: string;
  table?: string;
  sql: string;
}

/**
 * Returns every way the committed artifacts differ from `expected`. An empty
 * array means the Worker steps and the CLI migration steps are exactly the
 * projection of the canonical schema.
 */
function compare(
  expected: ExpectedSchema,
  workerSteps: readonly WorkerStep[],
  cliSteps: readonly MigrationStep[],
): string[] {
  const problems: string[] = [];
  const expectedTables = new Map(expected.tables.map((table) => [table.name, table]));
  // Only marked columns have an ALTER step; the rest are created with their table.
  const expectedColumns = new Map(
    expected.tables.flatMap((table) =>
      table.columns
        .filter((column) => column.legacyAdd)
        .map((column) => [`${table.name}.${column.name}`, { table, column }] as const),
    ),
  );
  const expectedIndexes = new Map(expected.indexes.map((index) => [index.name, index]));

  const workerTables = new Map<string, string>();
  const workerColumns = new Map<string, string>();
  const workerIndexes = new Map<string, string>();
  for (const step of workerSteps) {
    if (step.existing?.kind === "table") workerTables.set(step.existing.name, step.sql);
    else if (step.existing?.kind === "index") workerIndexes.set(step.existing.name, step.sql);
    else if (step.column) {
      workerColumns.set(`${step.column.table}.${step.column.name}`, step.sql);
    } else problems.push(`Worker step with no target: ${step.sql.slice(0, 40)}`);
  }

  const check = (
    kind: string,
    expectedEntries: Map<string, string>,
    actualEntries: Map<string, string>,
  ) => {
    for (const [name, sql] of expectedEntries) {
      const actual = actualEntries.get(name);
      if (actual === undefined) problems.push(`${kind} ${name} missing from the artifact`);
      else if (normalize(actual) !== normalize(sql)) {
        problems.push(`${kind} ${name} does not match schema.sql`);
      }
    }
    for (const name of actualEntries.keys()) {
      if (!expectedEntries.has(name)) problems.push(`${kind} ${name} is not defined in schema.sql`);
    }
  };

  check(
    "table",
    new Map([...expectedTables].map(([name, table]) => [name, table.sql])),
    workerTables,
  );
  check(
    "column",
    new Map(
      [...expectedColumns].map(([key, { table, column }]) => [
        key,
        `ALTER TABLE ${table.name} ADD COLUMN ${column.definition}`,
      ]),
    ),
    workerColumns,
  );
  check(
    "index",
    new Map([...expectedIndexes].map(([name, index]) => [name, index.sql])),
    workerIndexes,
  );

  const cliTables = new Map(
    cliSteps.filter((step) => step.type === "table").map((step) => [step.name, step.sql]),
  );
  const cliColumns = new Map(
    cliSteps
      .filter((step) => step.type === "column" && step.table)
      .map((step) => [`${step.table}.${step.name}`, step.sql]),
  );
  const cliIndexes = new Map(
    cliSteps.filter((step) => step.type === "index").map((step) => [step.name, step.sql]),
  );

  check(
    "migration table",
    new Map([...expectedTables].map(([name, table]) => [name, table.sql])),
    cliTables,
  );
  check(
    "migration column",
    new Map(
      [...expectedColumns].map(([key, { table, column }]) => [
        key,
        `ALTER TABLE ${table.name} ADD COLUMN ${column.definition}`,
      ]),
    ),
    cliColumns,
  );
  check(
    "migration index",
    new Map([...expectedIndexes].map(([name, index]) => [name, index.sql])),
    cliIndexes,
  );

  const expectedDrops = ["idx_access_passwords_hash", "idx_basket_items_index_id"];
  const actualDrops = cliSteps
    .filter((step) => step.type === "drop_index")
    .map((step) => step.name)
    .sort();
  if (JSON.stringify(actualDrops) !== JSON.stringify(expectedDrops)) {
    problems.push(`legacy index cleanup changed: ${actualDrops.join(", ")}`);
  }

  return problems;
}

const expected = parseExpected(schemaSql);

describe("D1: schema.sql is the single source of truth", () => {
  it("is the only definition of the deployed shape", () => {
    expect(expected.tables).toHaveLength(12);
    expect(expected.indexes).toHaveLength(7);
    expect(
      expected.tables.flatMap((table) => table.columns.filter((column) => column.legacyAdd)),
    ).toHaveLength(7);

    const ddl = schemaSql;
    expect(ddl).toMatch(/UNIQUE\(index_id, ticker\)/);
    expect(ddl).toMatch(/CHECK \(id = 1\)/);
    expect(ddl).toMatch(/role TEXT NOT NULL DEFAULT 'user'/);
    expect(ddl).toMatch(/id INTEGER PRIMARY KEY AUTOINCREMENT/);
    expect(ddl).toMatch(/REFERENCES indices \(id\) ON DELETE CASCADE/);
  });

  it("matches the generated Worker steps and CLI migration steps", () => {
    expect(compare(expected, REQUIRED_SCHEMA_STEPS, REQUIRED_MIGRATION_STEPS)).toEqual([]);
  });

  it("fails when schema.sql changes and the artifacts are not regenerated", () => {
    const mutated = schemaSql.replace(
      "    is_active INTEGER DEFAULT 1,",
      "    is_active INTEGER DEFAULT 1,\n    -- @legacy-add\n    brand_new TEXT,",
    );
    expect(mutated).not.toBe(schemaSql);

    const problems = compare(parseExpected(mutated), REQUIRED_SCHEMA_STEPS, REQUIRED_MIGRATION_STEPS);
    expect(problems.join("\n")).toContain("brand_new");
  });

  it("fails when an artifact defines something schema.sql does not", () => {
    const doctored: WorkerStep[] = [
      ...REQUIRED_SCHEMA_STEPS,
      { existing: { kind: "table", name: "ghost_table" }, sql: "CREATE TABLE IF NOT EXISTS ghost_table (id TEXT)" },
    ];
    const problems = compare(expected, doctored, REQUIRED_MIGRATION_STEPS);
    expect(problems.join("\n")).toContain("ghost_table");
  });

  it("keeps schema.migration.sql a projection of schema.sql", () => {
    expect(migrationSql).toContain("GENERATED FILE — do not edit");
    for (const table of expected.tables) {
      expect(migrationSql).toContain(table.sql);
    }
    for (const index of expected.indexes) {
      expect(migrationSql).toContain(index.sql);
    }
    for (const table of expected.tables) {
      for (const column of table.columns) {
        const alter = `ALTER TABLE ${table.name} ADD COLUMN ${column.definition}`;
        if (column.legacyAdd) expect(migrationSql).toContain(alter);
        else expect(migrationSql).not.toContain(alter);
      }
    }
    expect(migrationSql).toContain("DROP INDEX IF EXISTS idx_basket_items_index_id;");
    expect(migrationSql).toContain("DROP INDEX IF EXISTS idx_access_passwords_hash;");
    expect(migrationSql).toContain("UPDATE indices SET owner_token_issued_at");
  });

  it("leaves an already provisioned database with nothing to migrate", () => {
    const provisioned = {
      tables: new Set(expected.tables.map((table) => table.name)),
      indexes: new Set([
        ...expected.indexes.map((index) => index.name),
        "idx_basket_items_index_id",
        "idx_access_passwords_hash",
      ]),
      columns: new Map(
        expected.tables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))]),
      ),
    };
    // The only remaining work is dropping obsolete indexes; no table, column or
    // index of the current definition is pending.
    const pending = computePendingMigrations(provisioned);
    expect(pending.every((step) => step.type === "drop_index")).toBe(true);
    expect(pending).toHaveLength(2);
  });

  it("drops exactly the tables schema.sql defines when resetting", () => {
    const dropped = [
      ...schemaDevSql.matchAll(/DROP\s+TABLE\s+IF\s+EXISTS\s+([A-Za-z0-9_]+)/gi),
    ]
      .map((match) => match[1])
      .sort();
    expect(dropped).toEqual(expected.tables.map((table) => table.name).sort());
  });
});
