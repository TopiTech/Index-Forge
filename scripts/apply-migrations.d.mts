/**
 * Type declarations for the migration runner.
 *
 * The file mirrors `scripts/apply-migrations.mjs`. It used to declare a
 * `table` field on the index steps that the implementation never sets, which
 * `skipLibCheck` kept from being reported: a caller that relied on the
 * declared shape would have read `undefined` at runtime.
 */

export interface TableMigrationStep {
  type: "table";
  name: string;
  sql: string;
}

export interface IndexMigrationStep {
  type: "index";
  name: string;
  sql: string;
}

export interface ColumnMigrationStep {
  type: "column";
  table: string;
  name: string;
  sql: string;
}

export interface DropIndexMigrationStep {
  type: "drop_index";
  name: string;
  sql: string;
}

export type MigrationStep =
  | TableMigrationStep
  | IndexMigrationStep
  | ColumnMigrationStep
  | DropIndexMigrationStep;

export interface DatabaseProbeResult {
  tables: Set<string>;
  indexes: Set<string>;
  columns: Map<string, Set<string>>;
}

export const REQUIRED_MIGRATION_STEPS: readonly MigrationStep[];

export const OWNER_TOKEN_BACKFILL_SQL: string;

export function computePendingMigrations(
  probe: DatabaseProbeResult,
  steps?: readonly MigrationStep[],
): MigrationStep[];

export function parseWranglerJson(stdout: string): Record<string, unknown>[];

export function probeDatabase(
  targetFlag: "--local" | "--remote",
  configPath?: string,
  dbName?: string,
): DatabaseProbeResult;

export function runMigration(
  targetFlag?: "--local" | "--remote",
  configPath?: string,
  dbName?: string,
): { appliedCount: number; steps: MigrationStep[] };
