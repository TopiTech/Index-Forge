/**
 * Meta-test gate tests (N-7).
 *
 * The gate must catch every shape of source-string pin used in this
 * repository (plain toContain on readFileSync variables, `?raw` imports,
 * in-file read helpers, derived snippets, negative pins, positional pins)
 * while leaving assertions on parsed fixture data alone -- and it must fail
 * closed when an unregistered pin appears or a registered file grows.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  checkRepo,
  collectSourceTextVars,
  findSourcePins,
  isTestFileName,
  propagateDerivedVars,
} from "./check-meta-test-gate.mjs";

function withTree(files, run) {
  const root = mkdtempSync(join(tmpdir(), "meta-test-gate-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const PIN_FILE = {
  "src/a.test.ts": `
      const src = readFileSync("A.tsx", "utf8");
      it("pins", () => { expect(src).toContain("const x = 1;"); });
    `,
};

describe("meta-test gate: pin detection", () => {
  it("classifies test filenames strictly (decl files and config look-alikes stay out)", () => {
    expect(isTestFileName("foo.test.ts")).toBe(true);
    expect(isTestFileName("foo.spec.tsx")).toBe(true);
    expect(isTestFileName("tsconfig.test.json")).toBe(false);
    expect(isTestFileName("foo.test.d.ts")).toBe(false);
  });

  it("collects readFileSync/readFile assignments and ?raw imports as source text", () => {
    const text = `
      import rawCss from "../index.css?raw";
      const src = readFileSync(resolve(__dirname, "A.tsx"), "utf8");
      const viaFs = fs.readFileSync(path, "utf-8");
      const parsed = JSON.parse(readFileSync("fixture.json", "utf8"));
    `;
    const vars = collectSourceTextVars(text);
    expect(vars.has("rawCss")).toBe(true);
    expect(vars.has("src")).toBe(true);
    expect(vars.has("viaFs")).toBe(true);
    // JSON.parse(...) turns file text into data: assertions on it are not
    // source-text pins.
    expect(vars.has("parsed")).toBe(false);
  });

  it("tracks in-file read helpers (readSrc) and values derived from source text", () => {
    const text = `
      const readSrc = (rel) => readFileSync(resolve(here, rel), "utf8");
      const appSource = readSrc("App.tsx");
      const snippet = appSource.slice(0, 200);
      const parsedData = JSON.parse(readSrc("fixture.json"));
    `;
    const vars = propagateDerivedVars(text, collectSourceTextVars(text));
    expect(vars.has("readSrc")).toBe(true);
    expect(vars.has("appSource")).toBe(true);
    expect(vars.has("snippet")).toBe(true);
    // JSON.parse output is data, not source text.
    expect(vars.has("parsedData")).toBe(false);
  });

  it("finds plain, derived, negative and positional pins on source text", () => {
    const text = `
      const src = readFileSync("A.tsx", "utf8");
      const snippet = src.slice(0, 100);
      it("x", () => {
        expect(src).toContain("const MAX_SEARCH_RESULTS = 80;");
        expect(src).toMatch(/export function A\\(/);
        expect(src).not.toContain("Math.random");
        expect(snippet).toContain("hello");
        expect(src.indexOf('lazy(')).toBeGreaterThan(-1);
      });
    `;
    const pins = findSourcePins(text);
    expect(pins.map((p) => p.method).sort()).toEqual([
      "indexOf",
      "toContain",
      "toContain",
      "toContain",
      "toMatch",
    ]);
    expect(pins.some((p) => p.literal.includes("MAX_SEARCH_RESULTS"))).toBe(true);
  });

  it("ignores assertions on runtime data and parsed fixtures", () => {
    const text = `
      const fixture = JSON.parse(readFileSync("fixture.json", "utf8"));
      const src = readFileSync("A.tsx", "utf8");
      const rows = db.all();
      it("x", () => {
        expect(fixture.items).toContain("a");
        expect(rows[0].sql).toContain("CREATE TABLE");
      });
    `;
    const pins = findSourcePins(text);
    // Only assertions whose target traces back to source text count.
    expect(pins).toHaveLength(0);
  });
});

describe("meta-test gate: registry enforcement", () => {
  it("fails for an unregistered file with source pins", () => {
    withTree(PIN_FILE, (root) => {
      const result = checkRepo(root, {});
      expect(result.ok).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].kind).toBe("unregistered");
      expect(result.violations[0].file).toBe("src/a.test.ts");
    });
  });

  it("passes when the pin count is within the registered budget", () => {
    withTree(PIN_FILE, (root) => {
      const registry = { "src/a.test.ts": { budget: 1, category: "impl-source", reason: "test" } };
      expect(checkRepo(root, registry).ok).toBe(true);
    });
  });

  it("fails when a registered file grows past its budget (new pin slips in)", () => {
    const grown = {
      "src/a.test.ts": `
        const src = readFileSync("A.tsx", "utf8");
        it("pins", () => {
          expect(src).toContain("const x = 1;");
          expect(src).toContain("const y = 2;");
        });
      `,
    };
    withTree(grown, (root) => {
      const registry = { "src/a.test.ts": { budget: 1, category: "impl-source", reason: "test" } };
      const result = checkRepo(root, registry);
      expect(result.ok).toBe(false);
      expect(result.violations[0].kind).toBe("over-budget");
    });
  });

  it("keeps passing as converted tests shrink below budget (ratchet down)", () => {
    withTree(PIN_FILE, (root) => {
      const registry = { "src/a.test.ts": { budget: 5, category: "impl-source", reason: "test" } };
      expect(checkRepo(root, registry).ok).toBe(true);
    });
  });

  it("ignores test files that do not read repository files at all", () => {
    withTree(
      {
        "src/b.test.ts": `it("x", () => { expect("const x = 1;").toContain("x"); });`,
      },
      (root) => {
        expect(checkRepo(root, {}).ok).toBe(true);
      },
    );
  });

  it("the CLI exits 1 with guidance when a pin is unregistered", () => {
    withTree(PIN_FILE, (root) => {
      const script = resolve(process.cwd(), "scripts", "check-meta-test-gate.mjs");
      let failed = null;
      try {
        execFileSync(process.execPath, [script, "--root", root], { stdio: "pipe" });
      } catch (err) {
        failed = err;
      }
      expect(failed).not.toBeNull();
      expect(failed.status).toBe(1);
      expect(String(failed.stderr)).toContain("meta-test gate: FAIL");
      expect(String(failed.stderr)).toContain("source-pin-registry.json");
    });
  });
});

describe("meta-test gate: repository regression", () => {
  it("registers every current source pin in the checked-in registry", () => {
    const root = resolve(process.cwd());
    const registry = JSON.parse(
      readFileSync(join(root, "scripts", "source-pin-registry.json"), "utf8"),
    );
    const { ok, violations } = checkRepo(root, registry);
    expect(violations).toEqual([]);
    expect(ok).toBe(true);
  });

  it("every registry entry keeps a justification and a non-negative budget", () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "scripts", "source-pin-registry.json"), "utf8"),
    );
    for (const [file, entry] of Object.entries(registry)) {
      expect(typeof entry.budget, file).toBe("number");
      expect(entry.budget, file).toBeGreaterThanOrEqual(0);
      expect(typeof entry.reason, file).toBe("string");
      expect(entry.reason.length, file).toBeGreaterThan(10);
    }
  });

  it("is wired into npm test before vitest (re-inflow cannot skip it)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts.test).toContain("check:meta-test-gate");
    expect(pkg.scripts["check:meta-test-gate"]).toContain("check-meta-test-gate.mjs");
  });
});
