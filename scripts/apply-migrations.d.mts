export interface TableMigrationStep {
  type: "table";
  name: string;
  sql: string;
}

export interface IndexMigrationStep {
  type: "index";
  name: string;
  table: string;
  sql: string;
}

export interface ColumnMigrationStep {
  type: "column";
  table: string;
  name: string;
  sql: string;
}

export type MigrationStep =
  | TableMigrationStep
  | IndexMigrationStep
  | ColumnMigrationStep;

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
