/**
 * First-paint gate tests (I5).
 *
 * The gate reads dist/index.html as the authority for first-paint assets.
 * These tests verify that asset extraction does not depend on HTML attribute
 * order, that the byte budgets still reject heavyweight first-paint payloads,
 * and that a heavy chunk statically reachable from the entry is reported even
 * if it was left out of the preload list.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  evaluateFirstPaint,
  extractAssetReferences,
  findUnpreloadedStaticImports,
} from "./check-first-paint.mjs";

const NORMAL_HTML = `<!doctype html><html><head>
  <script type="module" crossorigin src="/assets/entry-abc.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/motion-def.js">
  <link rel="modulepreload" crossorigin href="/assets/lucide-ghi.js">
  <link rel="stylesheet" crossorigin href="/assets/index-jkl.css">
  <link href="https://fonts.example.com/font.css" rel="stylesheet">
  <script src="/legacy.js"></script>
</head><body></body></html>`;

const REORDERED_HTML = `<!doctype html><html><head>
  <script crossorigin src="/assets/entry-abc.js" type="module"></script>
  <link crossorigin href="/assets/motion-def.js" rel="modulepreload">
  <link href="/assets/lucide-ghi.js" rel="modulepreload" crossorigin>
  <link href="/assets/index-jkl.css" crossorigin rel="stylesheet">
  <link rel="stylesheet" href="https://fonts.example.com/font.css">
</head><body></body></html>`;

function withDist(files, run) {
  const root = mkdtempSync(join(tmpdir(), "first-paint-gate-"));
  try {
    mkdirSync(join(root, "assets"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(root, name), content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runGate(distDir) {
  const script = resolve(process.cwd(), "scripts", "check-first-paint.mjs");
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [script, "--dist", distDir], { encoding: "utf8" }),
      stderr: "",
    };
  } catch (err) {
    return {
      status: err.status,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

describe("first-paint gate: asset extraction (I5)", () => {
  it("extracts the same entry, preloads and stylesheet regardless of attribute order", () => {
    expect(extractAssetReferences(REORDERED_HTML)).toEqual(extractAssetReferences(NORMAL_HTML));
    expect(extractAssetReferences(NORMAL_HTML)).toEqual({
      entry: "entry-abc.js",
      preloads: ["motion-def.js", "lucide-ghi.js"],
      stylesheets: ["index-jkl.css"],
    });
  });

  it("only counts local /assets/ references, not external stylesheets or legacy scripts", () => {
    const refs = extractAssetReferences(REORDERED_HTML);
    expect(refs.preloads).toHaveLength(2);
    expect(refs.stylesheets).toEqual(["index-jkl.css"]);
    expect(refs.entry).toBe("entry-abc.js");
  });

  it("rejects the same oversized preload from a reordered fixture via the CLI", () => {
    const html = REORDERED_HTML.replace("/assets/motion-def.js", "/assets/heavy.js");
    withDist(
      {
        "index.html": html,
        "assets/entry-abc.js": "x".repeat(1000),
        "assets/heavy.js": "x".repeat(250_000),
        "assets/lucide-ghi.js": "x".repeat(10_000),
        "assets/index-jkl.css": "x".repeat(10_000),
      },
      (distDir) => {
        const result = runGate(distDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("preloaded chunk heavy.js");
      },
    );
  });

  it("fails when the entry statically imports a chunk missing from the preload list", () => {
    withDist(
      {
        "index.html": `<html><head><script type="module" crossorigin src="/assets/entry-abc.js"></script></head></html>`,
        "assets/entry-abc.js": 'import{ render }from"./chart-lib-xyz.js";render();',
        "assets/chart-lib-xyz.js": "x".repeat(10_000),
      },
      (distDir) => {
        const result = runGate(distDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("statically imports chart-lib-xyz.js");
      },
    );
  });

  it("passes a within-budget reordered fixture through the CLI", () => {
    withDist(
      {
        "index.html": REORDERED_HTML,
        "assets/entry-abc.js": "x".repeat(1000),
        "assets/motion-def.js": "x".repeat(10_000),
        "assets/lucide-ghi.js": "x".repeat(10_000),
        "assets/index-jkl.css": "x".repeat(10_000),
      },
      (distDir) => {
        const result = runGate(distDir);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("check-first-paint: OK");
      },
    );
  });
});

describe("first-paint gate: budgets and static reachability", () => {
  it("fails a heavyweight chunk statically imported by the entry", () => {
    const entrySource = 'import{ a }from"./chart-lib-xyz.js";import "./side.js";const lazy=()=>import("./lazy.js");';
    expect(findUnpreloadedStaticImports(entrySource, ["side.js"])).toEqual(["chart-lib-xyz.js"]);
    expect(findUnpreloadedStaticImports(entrySource, ["side.js", "chart-lib-xyz.js"])).toEqual([]);
  });

  it("flags oversized entry chunks and oversized totals", () => {
    const rows = [
      { name: "entry.js", role: "entry", raw: 600_000, gzip: 200_000 },
      { name: "app.css", role: "stylesheet", raw: 400_000, gzip: 100_000 },
    ];
    const { rawTotal, gzipTotal, violations } = evaluateFirstPaint(rows);
    expect(rawTotal).toBe(1_000_000);
    expect(gzipTotal).toBe(300_000);
    expect(violations.join("\n")).toMatch(/entry chunk entry\.js/);
    expect(violations.join("\n")).toMatch(/first-paint transfer/);
  });

  it("reports no violations for a small first-paint set", () => {
    const { violations } = evaluateFirstPaint([
      { name: "entry.js", role: "entry", raw: 1_000, gzip: 400 },
    ]);
    expect(violations).toEqual([]);
  });
});
