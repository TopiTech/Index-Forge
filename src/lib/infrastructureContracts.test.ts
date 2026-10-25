/**
 * Contract tests for the infrastructure and schema definitions.
 *
 * `schema.sql` is the single source of truth; the Worker's runtime provisioning
 * steps are generated from it into worker/schemaSteps.generated.ts and the
 * legacy migration into schema.migration.sql. The assertions below target the
 * generated Worker steps rather than the Worker source text, so the contracts
 * keep holding after the definition moved out of internal-impl.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { REQUIRED_SCHEMA_STEPS } from "../../worker/internal";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf-8");
}

const schemaSql = readRepoFile("schema.sql");
const migrationSql = readRepoFile("schema.migration.sql");
const workerDdl = REQUIRED_SCHEMA_STEPS.map((step) => step.sql).join("\n");
const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
const wranglerConfig = readRepoFile("wrangler.jsonc");

describe("schema provisioning parity", () => {
  it("creates the rate_limits purge index in both provisioning paths", () => {
    const index = "CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start)";

    expect(schemaSql).toContain(index);
    expect(workerDdl).toContain(index);
  });

  it("keeps the snapshot_cache single-row constraint in both provisioning paths", () => {
    expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS snapshot_cache \([\s\S]*?CHECK \(id = 1\)/);
    expect(workerDdl).toMatch(
      /CREATE TABLE IF NOT EXISTS snapshot_cache \([\s\S]*?CHECK \(id = 1\)/,
    );
  });

  it("keeps the indices creator index and drops the redundant lookup indexes", () => {
    // The creator lookup is a real query (`WHERE creator_id = ?`), so its index
    // has to exist in both provisioning paths.
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id)",
    );
    expect(workerDdl).toContain(
      "CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id)",
    );

    // INFRA-06: `idx_basket_items_index_id` only repeats the prefix of
    // UNIQUE(index_id, ticker) and `idx_access_passwords_hash` backed a lookup
    // that does not exist (password hashes are salted, so they are never
    // searched). Re-adding either one only costs a write per row.
    expect(schemaSql).not.toContain("idx_basket_items_index_id");
    expect(schemaSql).not.toContain("idx_access_passwords_hash");
    expect(workerDdl).not.toContain("idx_basket_items_index_id");
    expect(workerDdl).not.toContain("idx_access_passwords_hash");

    // The unique constraint that replaced the basket_items index must stay.
    expect(schemaSql).toMatch(/UNIQUE\(index_id, ticker\)/);

    // Existing databases get rid of the old indexes through the migration.
    expect(migrationSql).toContain("DROP INDEX IF EXISTS idx_basket_items_index_id;");
    expect(migrationSql).toContain("DROP INDEX IF EXISTS idx_access_passwords_hash;");
    expect(migrationSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start)",
    );
  });

  it("provisions the admin session and sync quota tables in schema.sql", () => {
    // SEC-01: administrator sessions are stored hashed, with an expiry.
    expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS admin_sessions \([\s\S]*?token_hash/);
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_admin_sessions_account_id ON admin_sessions(account_id)",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at)",
    );

    // SEC-11: the per-IP daily ticker budget for the unauthenticated sync.
    expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS sync_quota \([\s\S]*?PRIMARY KEY \(ip, day\)/);
  });
});

describe("deployment configuration", () => {
  it("cancels superseded CI runs for the same branch", () => {
    expect(ciWorkflow).toMatch(/concurrency:\s*\n\s*group: ci-/);
    expect(ciWorkflow).toContain("cancel-in-progress: true");
  });

  it("enables the observability master switch so the nested log settings apply", () => {
    // `observability.enabled` is the master switch: with it disabled the whole
    // block is dead configuration and the Worker emits no invocation logs.
    expect(wranglerConfig).toMatch(/"observability":\s*\{[\s\S]*?"enabled":\s*true/);
  });
});
