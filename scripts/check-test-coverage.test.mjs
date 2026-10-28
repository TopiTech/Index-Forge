/**
 * Test-runner coverage gate (check-test-coverage.mjs) のテスト (N-4 回帰防止)。
 *
 * ゲート自体の正しさを保証する:
 * - ファイル名判定のエッジケース (tsconfig.test.json の名前衝突、宣言ファイル等)
 * - glob マッチングのエッジケース
 * - 孤立テスト検出の発火 (orphan が exit 1 になること)
 * - ドリフト防止 (runner registry == vite.config.ts の include、npm test / CI に
 *   ゲートが組み込まれていること)
 * - 現在のリポジトリに orphan が無いこと (回帰防止)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import viteConfig from "../vite.config";
import {
  VITEST_INCLUDE,
  RUNNERS,
  collectTestFiles,
  findOrphanTestFiles,
  globToRegExp,
  isTestFileName,
  matchesAny,
  runCheck,
} from "./check-test-coverage.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATE_SCRIPT = join(REPO_ROOT, "scripts", "check-test-coverage.mjs");

const tempDirs = [];

function makeTree(files) {
  const root = mkdtempSync(join(tmpdir(), "check-test-coverage-"));
  tempDirs.push(root);
  for (const relPath of files) {
    const full = join(root, ...relPath.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "// fixture\n");
  }
  return root;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isTestFileName", () => {
  it("recognizes every file shape a runner can execute", () => {
    expect(isTestFileName("foo.test.ts")).toBe(true);
    expect(isTestFileName("foo.test.tsx")).toBe(true);
    expect(isTestFileName("foo.spec.ts")).toBe(true);
    expect(isTestFileName("foo.test.mjs")).toBe(true);
    expect(isTestFileName("foo.test.js")).toBe(true);
    expect(isTestFileName("foo.spec.mtsx")).toBe(false);
    expect(isTestFileName("check-test-coverage.test.mjs")).toBe(true);
  });

  it("rejects look-alike names that are not tests", () => {
    // Phase 1 の突合チェックが誤検出した名前衝突そのもの
    expect(isTestFileName("tsconfig.test.json")).toBe(false);
    expect(isTestFileName("apply-migrations.d.mts")).toBe(false);
    expect(isTestFileName("foo.test.d.ts")).toBe(false);
    expect(isTestFileName("foo.tests.ts")).toBe(false);
    expect(isTestFileName("setup.ts")).toBe(false);
    expect(isTestFileName("foo.test.ts.bak")).toBe(false);
    expect(isTestFileName("test-utils.ts")).toBe(false);
  });
});

describe("glob matching", () => {
  it("matches include patterns across depth and extensions", () => {
    expect(matchesAny("src/lib/foo.test.ts", VITEST_INCLUDE)).toBe(true);
    expect(matchesAny("src/lib/deep/nested/foo.spec.tsx", VITEST_INCLUDE)).toBe(true);
    expect(matchesAny("src/foo.test.tsx", VITEST_INCLUDE)).toBe(true);
    expect(matchesAny("worker/foo.test.ts", VITEST_INCLUDE)).toBe(true);
    expect(matchesAny("scripts/apply-migrations.test.mjs", VITEST_INCLUDE)).toBe(true);
    expect(matchesAny("scripts/sub/dir/foo.spec.ts", VITEST_INCLUDE)).toBe(true);
  });

  it("does not match files outside the runner includes", () => {
    expect(matchesAny("tests/foo.test.ts", VITEST_INCLUDE)).toBe(false);
    expect(matchesAny("foo.test.ts", VITEST_INCLUDE)).toBe(false);
    expect(matchesAny("docs/foo.spec.mjs", VITEST_INCLUDE)).toBe(false);
    // include に無い拡張子は orphan (エッジケース)
    expect(matchesAny("src/lib/foo.test.js", VITEST_INCLUDE)).toBe(false);
    expect(matchesAny("scripts/foo.test.jsx", VITEST_INCLUDE)).toBe(false);
  });

  it("anchors the glob and handles brace alternatives literally", () => {
    const re = globToRegExp("src/**/*.{test,spec}.{ts,tsx}");
    expect(re.test("src/lib/a.test.ts")).toBe(true);
    expect(re.test("src/lib/a.spec.tsx")).toBe(true);
    expect(re.test("src/lib/a.test.tsx.bak")).toBe(false);
    expect(re.test("xsrc/lib/a.test.ts")).toBe(false);
    expect(() => globToRegExp("src/**/*.{test,spec")).toThrow();
  });
});

describe("collectTestFiles", () => {
  it("walks nested directories but never enters build/dependency dirs", () => {
    const root = makeTree([
      "src/lib/a.test.ts",
      "src/lib/deep/b.spec.tsx",
      "worker/c.test.ts",
      "node_modules/pkg/d.test.ts",
      "dist/d.test.ts",
      ".git/e.test.ts",
      "src/test-helpers/setup.ts",
    ]);

    expect(collectTestFiles(root)).toEqual([
      "src/lib/a.test.ts",
      "src/lib/deep/b.spec.tsx",
      "worker/c.test.ts",
    ]);
  });
});

describe("findOrphanTestFiles", () => {
  it("fires on test files no runner executes", () => {
    const orphans = findOrphanTestFiles([
      "src/lib/a.test.ts",
      "tests/orphan.test.ts",
      "src/lib/orphan.test.js",
      "scripts/ok.test.mjs",
    ]);
    expect(orphans).toEqual(["tests/orphan.test.ts", "src/lib/orphan.test.js"]);
  });

  it("returns an empty list when every test file is covered", () => {
    expect(
      findOrphanTestFiles(["src/a.test.ts", "worker/b.spec.tsx", "scripts/c.test.mjs"]),
    ).toEqual([]);
  });
});

describe("runCheck gate", () => {
  it("exits 1 and names the orphan when a test file is unreachable", () => {
    const root = makeTree([
      "src/lib/a.test.ts",
      "tests/lost/orphan.test.ts",
    ]);

    expect(runCheck(root)).toBe(1);
  });

  it("exits 0 when every test file is covered", () => {
    const root = makeTree(["src/lib/a.test.ts", "scripts/b.test.mjs"]);
    expect(runCheck(root)).toBe(0);
  });

  it("exits 1 from the CLI entry point as well (wiring)", () => {
    const root = makeTree(["docs/orphan.test.mts"]);
    const result = spawnSync(process.execPath, [GATE_SCRIPT, "--root", root], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/orphan.test.mts");
    expect(result.stderr).toContain("runner registry");
  });

  it("exits 0 from the CLI entry point on a covered tree", () => {
    const root = makeTree(["src/lib/a.test.ts"]);
    const result = spawnSync(process.execPath, [GATE_SCRIPT, "--root", root], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
  });
});

describe("regression: registry and standard flow stay wired", () => {
  it("keeps the runner registry identical to vitest's include in vite.config.ts", () => {
    // registry が vitest より広い claims をすると fail-open (orphan を見逃す)。
    // 単一の情報源 (vite.config.ts) と一致させることで構造的に防ぐ。
    expect(VITEST_INCLUDE).toEqual(viteConfig.test?.include);
  });

  it("runs the gate before the test suite in `npm test`", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf-8"),
    );
    expect(pkg.scripts["check:test-coverage"]).toBe("node scripts/check-test-coverage.mjs");
    expect(pkg.scripts.test).toContain("check:test-coverage");
    expect(pkg.scripts.test).toContain("vitest run");
  });

  it("is reached by both CI workflows through `npm test`", () => {
    for (const workflow of ["ci.yml", "deploy.yml"]) {
      const text = readFileSync(
        join(REPO_ROOT, ".github", "workflows", workflow),
        "utf-8",
      );
      expect(text).toContain("npm test");
    }
  });

  it("reports the current repository as fully covered", () => {
    const files = collectTestFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(200);
    expect(findOrphanTestFiles(files)).toEqual([]);
  });

  it("keeps RUNNERS aligned with the exported include list", () => {
    expect(RUNNERS.map((runner) => runner.globs)).toEqual([VITEST_INCLUDE]);
  });
});
