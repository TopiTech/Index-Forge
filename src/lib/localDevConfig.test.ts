import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * U-8 M-12: the local Worker config must never leak a real D1 id into git.
 *
 * `wrangler.local.jsonc` intentionally carries the developer's real
 * `database_id` (dev-commands.md tells every clone to create it), so the only
 * thing standing between that secret and a commit is `.gitignore` — plus the
 * tracked `wrangler.jsonc` keeping its `__D1_DATABASE_ID__` placeholder and
 * `deploy.yml` injecting the real id from secrets at deploy time. These tests
 * lock all three halves of that arrangement: if any of them is removed, the
 * suite fails before the secret can ship.
 */
const repoRoot = resolve(__dirname, "../..");

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("local Worker config secret handling (U-8 M-12)", () => {
  it("keeps wrangler.local.jsonc out of git via .gitignore", () => {
    const gitignore = readRepo(".gitignore");
    expect(gitignore).toMatch(/^wrangler\.local\.jsonc$/m);
  });

  it("keeps the tracked wrangler.jsonc on the placeholder database id", () => {
    const tracked = readRepo("wrangler.jsonc");
    expect(tracked).toContain("__D1_DATABASE_ID__");
    // A 32-hex D1 id in the tracked config means a real secret was committed.
    expect(tracked).not.toMatch(/"database_id":\s*"[0-9a-f-]{32,}"/);
  });

  it("injects the real database id from secrets only in deploy.yml", () => {
    const deploy = readRepo(".github/workflows/deploy.yml");
    expect(deploy).toContain("D1_DATABASE_ID");
    expect(deploy).toContain("__D1_DATABASE_ID__");
  });
});
