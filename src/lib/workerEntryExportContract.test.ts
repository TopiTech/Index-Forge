import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Workers runtime treats every named export of the entry module
 * (`worker/index.ts`, the `main` in wrangler) as an `ExportedHandler` map entry
 * and refuses to boot when a name resolves to a non-handler value:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'NAME':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * That failure only appears at `wrangler dev` / deploy time — TypeScript, ESLint
 * and vitest all pass — which is why it is guarded here structurally.
 */
const entrySource = readFileSync(resolve("worker/index.ts"), "utf8");
const implSource = readFileSync(resolve("worker/internal-impl.ts"), "utf8");

describe("worker entry module export contract", () => {
  it("declares a default export", () => {
    expect(entrySource).toMatch(/export\s+default\s+handler;/);
  });

  it("has no named exports at all", () => {
    // Anything other than `export default` is a boot-time error in workerd.
    const namedExports = entrySource
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("export "))
      .filter((line) => !line.startsWith("export default"));

    expect(namedExports).toEqual([]);
  });

  it("does not re-export implementation symbols", () => {
    expect(entrySource).not.toMatch(/^export\s*\{/m);
    expect(entrySource).not.toMatch(/^export\s+(const|function|class|interface|type|let|var)\b/m);
  });

  it("delegates to the internal implementation module", () => {
    expect(entrySource).toMatch(/from\s+"\.\/internal-impl"/);
  });
});

describe("worker implementation module", () => {
  it("holds the fetch handler and the shared helpers", () => {
    expect(implSource).toMatch(/export\s+default\s*\{/);
    expect(implSource).toMatch(/async\s+fetch\s*\(/);
  });

  it("is not referenced as the wrangler entry point", () => {
    // The entry point must stay worker/index.ts; pointing `main` at the
    // implementation module would re-introduce every named export as a handler.
    const wrangler = readFileSync(resolve("wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"main": "worker/index.ts"');
    expect(wrangler).not.toContain("internal-impl");
  });
});
