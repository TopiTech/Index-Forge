import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs } from "./apply-migrations.mjs";

test("parseCliArgs defaults", () => {
  const result = parseCliArgs([]);
  assert.deepEqual(result, {
    targetFlag: "--local",
    configPath: "wrangler.local.jsonc",
    dbName: "original-stock-index-db",
  });
});

test("parseCliArgs parses --remote flag", () => {
  const result = parseCliArgs(["--remote"]);
  assert.equal(result.targetFlag, "--remote");
  assert.equal(result.configPath, "wrangler.local.jsonc");
  assert.equal(result.dbName, "original-stock-index-db");
});

test("parseCliArgs parses --config", () => {
  const separated = parseCliArgs(["--config", "wrangler.jsonc"]);
  assert.equal(separated.configPath, "wrangler.jsonc");

  const inline = parseCliArgs(["--config=wrangler.jsonc"]);
  assert.equal(inline.configPath, "wrangler.jsonc");
});

test("parseCliArgs parses --database and --db", () => {
  const databaseFlag = parseCliArgs(["--database", "prod-db"]);
  assert.equal(databaseFlag.dbName, "prod-db");

  const databaseInline = parseCliArgs(["--database=prod-db"]);
  assert.equal(databaseInline.dbName, "prod-db");

  const dbFlag = parseCliArgs(["--db", "custom-db"]);
  assert.equal(dbFlag.dbName, "custom-db");

  const dbInline = parseCliArgs(["--db=custom-db"]);
  assert.equal(dbInline.dbName, "custom-db");
});

test("parseCliArgs parses all arguments in arbitrary order", () => {
  const result = parseCliArgs([
    "--remote",
    "--config",
    "wrangler.jsonc",
    "--db",
    "my-production-db",
  ]);
  assert.deepEqual(result, {
    targetFlag: "--remote",
    configPath: "wrangler.jsonc",
    dbName: "my-production-db",
  });
});
