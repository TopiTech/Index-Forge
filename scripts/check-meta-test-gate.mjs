/**
 * Meta-test gate (N-7).
 *
 * N-7's root cause is "tests verify implementation text instead of
 * behaviour": `readFileSync`-based meta tests pin source strings with
 * `toContain`, so refactors break tests while real regressions slip through.
 * Converting the backlog is only half the fix -- without a gate, every future
 * review pass can quietly add another source-string pin.
 *
 * This script makes the boundary explicit. It inventories every test file
 * that reads repository files, follows the variables that hold *source text*
 * (including values derived from it), and fails (exit 1) when a source-text
 * assertion exists that is not registered in `scripts/source-pin-registry.json`
 * or exceeds its registered budget. The registry is the conscious, reviewable
 * inventory of remaining pins: converting a test shrinks the count for free,
 * adding a pin requires editing the registry -- and the budgets are designed
 * to only ever shrink.
 *
 * Assertions on parsed data (JSON.parse of a fixture) are not pins: only
 * assertions on the text of repository files are.
 *
 * Usage:
 *   node scripts/check-meta-test-gate.mjs [--root <dir>] [--report]
 *
 * Pure helpers are exported for `scripts/check-meta-test-gate.test.mjs`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directories never walked into (build output, VCS metadata, dependencies). */
export const IGNORED_DIRS = new Set([
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

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function isTestFileName(name) {
  return TEST_FILE_RE.test(name);
}

/**
 * Names of methods whose result on source text is still source text.
 * `JSON.parse` is deliberately absent: parsed data is data, not text.
 */
const TEXT_PRESERVING_CALL_RE =
  /\.(match|matchAll|slice|split|substring|substr|trim|toLowerCase|toUpperCase|replace|replaceAll|normalize|padStart|padEnd|concat|repeat|indexOf|includes|startsWith|endsWith|at|at2)\s*\(/;

/**
 * Extract the variable names that hold repository source text.
 *
 * Handles `readFileSync(...)` / `readFile(...)` assignments and `?raw` Vite
 * imports. Returns a Set of identifier names.
 */
export function collectSourceTextVars(text) {
  const vars = new Set();
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[A-Za-z_$][\w$]*\.)?readFileSync\s*\(/g)) {
    vars.add(m[1]);
  }
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[A-Za-z_$][\w$]*\.)?readFile\s*\(/g)) {
    vars.add(m[1]);
  }
  // Vite `?raw` imports carry file text: `import css from "../index.css?raw";`
  for (const m of text.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s+["'][^"']*\?raw["']/g)) {
    vars.add(m[1]);
  }
  // In-file helper wrappers around file reads (e.g.
  // `const readSrc = (rel: string) => readFileSync(resolve(here, rel), "utf8");`)
  // produce source text just like the underlying read.
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*[^;\n]*readFile/g)) {
    vars.add(m[1]);
  }
  for (const m of text.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[^}]{0,300}?readFile/g)) {
    vars.add(m[1]);
  }
  return vars;
}

/**
 * Extend the source-text variable set through derived values: anything
 * assigned from a source-text variable through a text-preserving operation is
 * still source text (`const snippet = src.slice(a, b)`). `JSON.parse(...)`
 * and similar produce data and are excluded. Runs to a fixpoint.
 */
export function propagateDerivedVars(text, vars) {
  const assignmentRe =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  const assignments = [...text.matchAll(assignmentRe)].map((m) => ({
    name: m[1],
    rhs: m[2],
  }));
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, rhs } of assignments) {
      if (vars.has(name)) continue;
      if (/JSON\.parse\s*\(/.test(rhs)) continue;
      const mentionsKnown = [...vars].some(
        (v) => new RegExp(`\\b${v.replace(/\$/g, "\\$")}\\b`).test(rhs),
      );
      if (!mentionsKnown) continue;
      // Either a direct text-preserving call on a known var, a call to a
      // known source-text helper (`readSrc(...)`), or a template/concatenation
      // that keeps the text.
      const callsKnown = [...vars].some((v) =>
        new RegExp(`\\b${v.replace(/\$/g, "\\$")}\\s*\\(`).test(rhs),
      );
      const keepsText =
        TEXT_PRESERVING_CALL_RE.test(rhs) ||
        callsKnown ||
        rhs.includes("`") ||
        rhs.includes("+");
      if (keepsText) {
        vars.add(name);
        changed = true;
      }
    }
  }
  return vars;
}

/**
 * Find source-text pins: assertions whose target is source text.
 *
 * Returns [{ line, variable, method, literal }]. Covers the forms used in
 * this repository:
 *   expect(src).toContain("...")
 *   expect(src).toMatch(/.../)
 *   expect(src.slice(a, b)).toContain("...")
 *   expect(src.indexOf("...")).toBeGreaterThan(-1)
 *   expect(readFileSync(...)).toContain("...")
 */
const LITERAL = "(?:`[^`]*`|\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|/(?:\\\\.|\\[[^\\]]*\\]|[^/\\n])+/[a-z]*)";

const ASSERTION_RE = new RegExp(
  "expect\\s*\\(\\s*([\\s\\S]{0,240}?)\\s*\\)\\s*\\.\\s*(?:not\\s*\\.\\s*)?(toContain|toMatch|toStartWith|toEndWith)\\s*\\(\\s*(" +
    LITERAL +
    ")",
  "g",
);

const POSITIONAL_RE = new RegExp(
  "expect\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\.(indexOf|match|search)\\s*\\(\\s*(" + LITERAL + ")",
  "g",
);

export function findSourcePins(text) {
  const vars = propagateDerivedVars(text, collectSourceTextVars(text));
  const isSourceTarget = (expr) => {
    const name = expr.trim().split(/[^A-Za-z0-9_$]/)[0];
    return vars.has(name);
  };
  const pins = [];
  const lineAt = (index) => text.slice(0, index).split("\n").length;
  for (const m of text.matchAll(ASSERTION_RE)) {
    const target = m[1];
    if (!isSourceTarget(target)) continue;
    pins.push({
      line: lineAt(m.index),
      variable: target.trim().split(/[^A-Za-z0-9_$]/)[0],
      method: m[2],
      literal: m[3],
    });
  }
  for (const m of text.matchAll(POSITIONAL_RE)) {
    if (!vars.has(m[1])) continue;
    pins.push({ line: lineAt(m.index), variable: m[1], method: m[2], literal: m[3] });
  }
  pins.sort((a, b) => a.line - b.line);
  return pins;
}

/** Recursively list test files under `root`. */
export function listTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) {
        if (IGNORED_DIRS.has(name.name)) continue;
        walk(join(dir, name.name));
      } else if (isTestFileName(name.name)) {
        out.push(join(dir, name.name));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Check the repository against the registry.
 *
 * Returns { ok, violations, inventory } where inventory is a sorted list of
 * { file, pins, methods } for every file with at least one source pin.
 */
export function checkRepo(root, registry) {
  const violations = [];
  const inventory = [];
  for (const abs of listTestFiles(root)) {
    const rel = relative(root, abs).split("\\").join("/");
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!/readFileSync|readFile\s*\(|\?raw/.test(text)) continue;
    const pins = findSourcePins(text);
    if (pins.length === 0) continue;
    const methods = [...new Set(pins.map((p) => p.method))].sort();
    inventory.push({ file: rel, pins: pins.length, methods });
    const entry = registry[rel];
    if (!entry) {
      violations.push({
        file: rel,
        kind: "unregistered",
        pins: pins.length,
        detail: `登録なしのソース文字列ピン ${pins.length} 件 (先頭: ${pins[0].literal})`,
      });
    } else if (typeof entry.budget !== "number" || entry.budget < 0) {
      violations.push({ file: rel, kind: "bad-registry", pins: pins.length, detail: "registry の budget が不正" });
    } else if (pins.length > entry.budget) {
      violations.push({
        file: rel,
        kind: "over-budget",
        pins: pins.length,
        detail: `ピン ${pins.length} 件が登録予算 ${entry.budget} を超過`,
      });
    }
  }
  inventory.sort((a, b) => a.file.localeCompare(b.file));
  return { ok: violations.length === 0, violations, inventory };
}

export function loadRegistry(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : ".";
  const report = args.includes("--report");
  const root = resolve(process.cwd(), rootArg);
  const registryPath = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "source-pin-registry.json",
  );
  const registry = loadRegistry(registryPath);
  const { ok, violations, inventory } = checkRepo(root, registry);

  if (report) {
    console.log("source-pin inventory (file → pins):");
    for (const row of inventory) {
      console.log(`  ${row.pins}\t${row.file}\t[${row.methods.join(",")}]`);
    }
    console.log(`total files with source pins: ${inventory.length}`);
    console.log(`total pins: ${inventory.reduce((n, r) => n + r.pins, 0)}`);
  }

  if (!ok) {
    console.error("meta-test gate: FAIL — ソース文字列ピンの登録漏れ/予算超過があります。");
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.detail}`);
    }
    console.error(
      "対応: 振る舞いアサーションまたは実装非依存の検証へ転換するか、正当な構造ガードとして\n" +
        "scripts/source-pin-registry.json に予算と理由を明示的に登録してください (予算は縮小のみ)。",
    );
    process.exit(1);
  }
  console.log(
    `meta-test gate: PASS — 登録済みソースピン ${inventory.reduce((n, r) => n + r.pins, 0)} 件 / ${inventory.length} ファイル (すべて registry 管理下)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
