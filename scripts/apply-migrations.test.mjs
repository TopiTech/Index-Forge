/**
 * CLI 引数解析 (parseCliArgs) のテスト。
 *
 * 旧実装は `node:test` 形式だったが、どの npm script・CI ステップからも実行
 * されていなかった (N-4)。標準ランナー (vitest) に統一し、`npm test` /
 * CI の "Run Tests" から実行されるようにした。検証内容は変更しない。
 */
import { describe, expect, it, vi } from "vitest";
import {
  OWNER_TOKEN_BACKFILL_SQL,
  parseCliArgs,
  parseWranglerJson,
  probeDatabase,
  runMigration,
} from "./apply-migrations.mjs";

describe("parseCliArgs", () => {
  it("defaults", () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({
      targetFlag: "--local",
      configPath: "wrangler.local.jsonc",
      dbName: "original-stock-index-db",
    });
  });

  it("parses --remote flag", () => {
    const result = parseCliArgs(["--remote"]);
    expect(result.targetFlag).toBe("--remote");
    expect(result.configPath).toBe("wrangler.local.jsonc");
    expect(result.dbName).toBe("original-stock-index-db");
  });

  it("parses --config", () => {
    const separated = parseCliArgs(["--config", "wrangler.jsonc"]);
    expect(separated.configPath).toBe("wrangler.jsonc");

    const inline = parseCliArgs(["--config=wrangler.jsonc"]);
    expect(inline.configPath).toBe("wrangler.jsonc");
  });

  it("parses --database and --db", () => {
    const databaseFlag = parseCliArgs(["--database", "prod-db"]);
    expect(databaseFlag.dbName).toBe("prod-db");

    const databaseInline = parseCliArgs(["--database=prod-db"]);
    expect(databaseInline.dbName).toBe("prod-db");

    const dbFlag = parseCliArgs(["--db", "custom-db"]);
    expect(dbFlag.dbName).toBe("custom-db");

    const dbInline = parseCliArgs(["--db=custom-db"]);
    expect(dbInline.dbName).toBe("custom-db");
  });

  it("parses all arguments in arbitrary order", () => {
    const result = parseCliArgs([
      "--remote",
      "--config",
      "wrangler.jsonc",
      "--db",
      "my-production-db",
    ]);
    expect(result).toEqual({
      targetFlag: "--remote",
      configPath: "wrangler.jsonc",
      dbName: "my-production-db",
    });
  });

  it("throws on unknown flags instead of silently ignoring a typo", () => {
    expect(() => parseCliArgs(["--remtoe"])).toThrow(/unknown option/i);
    expect(() => parseCliArgs(["--config", "wrangler.jsonc", "--bogus"])).toThrow(/unknown option/i);
    expect(() => parseCliArgs(["positional"])).toThrow(/unknown option/i);
  });

  it("throws when a value-taking flag has no usable value", () => {
    expect(() => parseCliArgs(["--config"])).toThrow(/requires a value/i);
    expect(() => parseCliArgs(["--config", "--db"])).toThrow(/requires a value/i);
    expect(() => parseCliArgs(["--config="])).toThrow(/requires a value/i);
    expect(() => parseCliArgs(["--database="])).toThrow(/requires a value/i);
    expect(() => parseCliArgs(["--db="])).toThrow(/requires a value/i);
  });
});

describe("parseWranglerJson (I2 fail-closed)", () => {
  it("keeps accepting the two normal Wrangler result shapes", () => {
    expect(
      parseWranglerJson(JSON.stringify([{ results: [{ name: "indices", type: "table" }] }])),
    ).toEqual([{ name: "indices", type: "table" }]);
    expect(
      parseWranglerJson(JSON.stringify({ results: [{ cid: 0, name: "id" }] })),
    ).toEqual([{ cid: 0, name: "id" }]);
  });

  it("throws on malformed JSON or an unexpected result shape", () => {
    expect(() => parseWranglerJson("not-json")).toThrow(/Wrangler JSON/i);
    expect(() => parseWranglerJson("")).toThrow(/Wrangler JSON/i);
    expect(() => parseWranglerJson("{}")).toThrow(/results/i);
    expect(() => parseWranglerJson("[]")).toThrow(/results/i);
    expect(() => parseWranglerJson('[{"results":"not-an-array"}]')).toThrow(/results/i);
  });

  it("makes probeDatabase fail closed when Wrangler output cannot be parsed", () => {
    const brokenExec = () => "not-json";
    expect(() => probeDatabase("--local", "wrangler.jsonc", "db", brokenExec)).toThrow(/Wrangler JSON/i);
  });
});

describe("runMigration backfill (I3)", () => {
  it("throws a retryable error when the owner_token_issued_at backfill fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exec = (_targetFlag, _configPath, _dbName, sql) => {
      if (sql === OWNER_TOKEN_BACKFILL_SQL) throw new Error("D1 write failed");
      if (sql.includes("sqlite_master")) {
        return JSON.stringify([{ results: [{ type: "table", name: "indices" }] }]);
      }
      if (sql.startsWith("PRAGMA table_info")) {
        return JSON.stringify([
          { results: [{ name: "id" }, { name: "owner_token_hash" }, { name: "owner_token_issued_at" }] },
        ]);
      }
      return "";
    };
    try {
      expect(() => runMigration("--local", "wrangler.jsonc", "db", exec)).toThrow(
        /owner_token_issued_at backfill failed/i,
      );
      expect(() => runMigration("--local", "wrangler.jsonc", "db", exec)).toThrow(/re-?run|再実行/i);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
