/**
 * Test-runner coverage gate (N-4).
 *
 * `scripts/apply-migrations.test.mjs` used to sit outside every runner's
 * include pattern, so no npm script and no CI step ever executed it. The root
 * cause was not that one file: nothing in the verification flow noticed when a
 * test file was not reachable from *any* runner, so "which files get run" was
 * an implicit convention of file placement.
 *
 * This script makes the convention explicit and enforces it: it inventories
 * every test-shaped file in the repository and fails (exit 1) whenever one of
 * them is matched by no runner's include patterns. `npm test` runs it before
 * vitest, so an orphaned test file fails both the local verification and CI.
 *
 * Usage:
 *   node scripts/check-test-coverage.mjs [--root <dir>]
 *
 * Pure helpers are exported for `scripts/check-test-coverage.test.mjs`.
 */
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runner registry: the include patterns each test runner executes.
 *
 * The vitest entry mirrors `test.include` in `vite.config.ts` (the single
 * source of truth for what vitest runs). `check-test-coverage.test.mjs`
 * asserts the two arrays are identical, so this registry can never claim
 * coverage a runner does not actually provide.
 */
export const VITEST_INCLUDE = [
  "src/**/*.{test,spec}.{ts,tsx}",
  "worker/**/*.{test,spec}.{ts,tsx}",
  "scripts/**/*.{test,spec}.{ts,tsx,mjs}",
];

export const RUNNERS = [
  { name: "vitest (npm test → vitest run)", globs: VITEST_INCLUDE },
];

/**
 * Test-shaped file names. The extension list is closed on purpose: a file is
 * only a test when the runner could execute it. That also keeps known
 * look-alikes out of the inventory -- `tsconfig.test.json` (`.test.` in the
 * name but a JSON extension) and `*.test.d.ts` declaration files are not
 * tests. (The Phase 1 coverage sweep mis-detected `tsconfig.test.json` for
 * exactly this reason.)
 */
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Directories never walked into (build output, VCS metadata, dependencies). */
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".vite",
  ".wrangler",
  ".next",
  ".freebuff",
]);

export function isTestFileName(name) {
  return TEST_FILE_RE.test(name);
}

function globToSource(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more whole path segments; a bare `**` spans
        // separators within the remaining segment.
        if (glob[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        throw new Error(`glob に閉じ括弧がありません: ${glob}`);
      }
      const alternatives = glob
        .slice(i + 1, end)
        .split(",")
        .map((part) => globToSource(part));
      out += `(?:${alternatives.join("|")})`;
      i = end + 1;
      continue;
    }
    out += ch.replace(/[.+^$()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return out;
}

/** Translate a glob (`**`, `*`, `?`, `{a,b}`) into an anchored RegExp. */
export function globToRegExp(glob) {
  return new RegExp(`^${globToSource(glob)}$`);
}

function toPosix(path) {
  return path.split(sep).join("/");
}

export function matchesAny(posixPath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(posixPath));
}

/** Recursively inventory every test-shaped file under `rootDir` (sorted). */
export function collectTestFiles(rootDir) {
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && isTestFileName(entry.name)) {
        results.push(toPosix(relative(rootDir, join(dir, entry.name))));
      }
    }
  };
  walk(rootDir);
  return results.sort();
}

/**
 * Return the files no runner executes. This is the gate's core: an empty
 * result is the only acceptable state.
 */
export function findOrphanTestFiles(files, includeGlobs = VITEST_INCLUDE) {
  return files.filter((file) => !matchesAny(file, includeGlobs));
}

/** Gate entry point. Returns the process exit code (0 clean, 1 orphans). */
export function runCheck(rootDir) {
  const files = collectTestFiles(rootDir);
  const orphans = findOrphanTestFiles(files);
  if (orphans.length > 0) {
    console.error(
      `[check-test-coverage] ${orphans.length} 個のテストファイルがどのテストランナーからも実行されていません:`,
    );
    for (const orphan of orphans) {
      console.error(`  - ${orphan}`);
    }
    console.error("runner registry:");
    for (const runner of RUNNERS) {
      console.error(`  - ${runner.name}: ${runner.globs.join(", ")}`);
    }
    console.error(
      "vitest の include (vite.config.ts) に追加するか、テストではないファイルなら名前を変更・削除してください。",
    );
    return 1;
  }
  console.log(
    `[check-test-coverage] ${files.length} 個のテストファイルすべてが runner 対象です (orphan 0 件)。`,
  );
  return 0;
}

function parseRootDir(argv) {
  const idx = argv.indexOf("--root");
  if (idx !== -1 && argv[idx + 1]) {
    return resolve(argv[idx + 1]);
  }
  return resolve(fileURLToPath(new URL("..", import.meta.url)));
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exitCode = runCheck(parseRootDir(process.argv.slice(2)));
}
