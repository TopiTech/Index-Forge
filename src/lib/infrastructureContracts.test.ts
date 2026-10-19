/**
 * Contract tests for the infrastructure and schema definitions.
 *
 * The schema is provisioned in two places: `schema.sql` (used by the
 * migration scripts) and the Worker's runtime provisioning (`ensurePasswordTable`).
 * A table or index that exists in only one of them silently diverges, so the
 * two definitions are asserted to stay in sync.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf-8");
}

const schemaSql = readRepoFile("schema.sql");
const workerImpl = readRepoFile("worker/internal-impl.ts");
const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
const wranglerConfig = readRepoFile("wrangler.jsonc");

describe("schema provisioning parity", () => {
  it("creates the rate_limits purge index in both provisioning paths", () => {
    const index = "CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start)";

    expect(schemaSql).toContain(index);
    expect(workerImpl).toContain(index);
  });

  it("keeps the snapshot_cache single-row constraint in both provisioning paths", () => {
    expect(schemaSql).toMatch(/CREATE TABLE IF NOT EXISTS snapshot_cache \([\s\S]*?CHECK \(id = 1\)/);
    expect(workerImpl).toMatch(
      /CREATE TABLE IF NOT EXISTS snapshot_cache \([\s\S]*?CHECK \(id = 1\)/,
    );
  });

  it("keeps the basket_items and indices creator indexes", () => {
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_basket_items_index_id ON basket_items(index_id)",
    );
    expect(schemaSql).toContain(
      "CREATE INDEX IF NOT EXISTS idx_indices_creator_id ON indices(creator_id)",
    );
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
