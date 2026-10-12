import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") listFiles(full, out);
    } else if (/\.(tsx|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Regression guard: components reference CSS custom properties such as
// var(--color-positive) and var(--bg-app). If a token is renamed or a
// reference is added without a matching declaration, the value resolves to
// nothing at computed-value time (color/background/stroke silently fall
// back), which is exactly the class of bug this test prevents.
describe("CSS custom property completeness", () => {
  it("every var(--…) reference resolves to a declared custom property", () => {
    const declared = new Set<string>();
    const referenced = new Set<string>();

    for (const file of listFiles(resolve("src"))) {
      const source = readFileSync(file, "utf8");
      // Declarations: `--token: value;` (incl. JS style-object keys "--token": …)
      for (const match of source.matchAll(/(^|[\s{;"'])(--[a-zA-Z0-9-]+)\s*:/g)) {
        declared.add(match[2]);
      }
      // References without a fallback: var(--token). These MUST be declared,
      // otherwise the value is guaranteed-invalid at computed-value time.
      for (const match of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g)) {
        referenced.add(match[1]);
      }
    }

    const missing = [...referenced].filter((name) => !declared.has(name)).sort();
    expect(missing, `Undeclared CSS custom properties: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the gain/loss and app-canvas semantic aliases declared", () => {
    const tokens = readFileSync(resolve("src/styles/tokens.css"), "utf8");
    expect(tokens).toMatch(/--color-positive:\s*var\(--neon-green\)/);
    expect(tokens).toMatch(/--color-negative:\s*var\(--neon-red\)/);
    expect(tokens).toMatch(/--bg-app:\s*var\(--bg-dark\)/);
  });
});
