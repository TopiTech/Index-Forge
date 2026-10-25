/**
 * C-4 — executable contract for `seed.sql`.
 *
 * `INSERT OR REPLACE` is DELETE+INSERT in SQLite: re-running the seed burned
 * `AUTOINCREMENT` row identity and briefly removed rows other statements (or
 * readers) could observe. The basket seed now uses
 * `ON CONFLICT(index_id, ticker) DO UPDATE`, which requires the
 * `UNIQUE(index_id, ticker)` constraint from `schema.sql` and leaves row
 * identity — and the owner metadata the indices upsert preserves — intact.
 *
 * Like `schemaContract.test.ts` this applies the real files to a throwaway
 * in-memory SQLite database (`node:sqlite`, no network, no Wrangler).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

type Row = Record<string, SQLOutputValue>;
type SqliteModule = typeof import("node:sqlite");

const schemaSql = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
const seedSql = readFileSync(new URL("../../seed.sql", import.meta.url), "utf8");

async function freshSeededDb(): Promise<DatabaseSync> {
  const sqlite: SqliteModule = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(schemaSql);
  db.exec(seedSql);
  return db;
}

function basketSnapshot(db: DatabaseSync): { count: number; ids: SQLOutputValue[] } {
  const rows = db.prepare("SELECT id FROM basket_items ORDER BY id").all() as Row[];
  return { count: rows.length, ids: rows.map((row) => row.id) };
}

describe("seed.sql idempotence (C-4)", () => {
  it("contains no INSERT OR REPLACE outside comments", () => {
    const code = seedSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toContain("OR REPLACE");
  });

  it("upserts every basket statement on UNIQUE(index_id, ticker)", () => {
    const upserts = seedSql.match(/ON CONFLICT\(index_id, ticker\) DO UPDATE/g) ?? [];
    const inserts = seedSql.match(/INSERT INTO basket_items/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(upserts).toHaveLength(inserts.length);
  });

  it("keeps row counts and row identity stable across re-runs", async () => {
    const db = await freshSeededDb();
    const first = basketSnapshot(db);
    expect(first.count).toBeGreaterThan(0);

    db.exec(seedSql);
    const second = basketSnapshot(db);
    expect(second.count).toBe(first.count);
    // Upsert updates in place; REPLACE would have burned new AUTOINCREMENT ids.
    expect(second.ids).toEqual(first.ids);
    db.close();
  });

  it("restores seed values without touching owner metadata on re-run", async () => {
    const db = await freshSeededDb();

    // A user edit plus owner metadata set after the first seed.
    db.exec(
      "UPDATE basket_items SET weight = 999 WHERE index_id = 'ai-semi' AND ticker = '9984'; " +
        "UPDATE indices SET owner_token_hash = 'owner-hash', owner_token_issued_at = 1700000000 WHERE id = 'ai-semi';",
    );

    db.exec(seedSql);

    const weight = db
      .prepare("SELECT weight FROM basket_items WHERE index_id = 'ai-semi' AND ticker = '9984'")
      .get() as Row;
    // The seed is authoritative for the seeded rows: the edit is reset.
    expect(weight.weight).toBe(15);
    const owner = db
      .prepare("SELECT owner_token_hash, owner_token_issued_at FROM indices WHERE id = 'ai-semi'")
      .get() as Row;
    // ... while the owner columns the indices upsert preserves are untouched.
    expect(owner.owner_token_hash).toBe("owner-hash");
    expect(owner.owner_token_issued_at).toBe(1700000000);
    db.close();
  });
});
