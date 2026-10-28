/**
 * CLI 引数解析 (parseCliArgs) のテスト。
 *
 * 旧実装は `node:test` 形式だったが、どの npm script・CI ステップからも実行
 * されていなかった (N-4)。標準ランナー (vitest) に統一し、`npm test` /
 * CI の "Run Tests" から実行されるようにした。検証内容は変更しない。
 */
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./apply-migrations.mjs";

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
});
