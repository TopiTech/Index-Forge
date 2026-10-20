/**
 * Regression guards for defects fixed in the full-project code review.
 *
 * 1. App.handleAddToPortfolio used to fall back to a fabricated price of 100
 *    when neither the live quote nor fundamentals had a valid price, silently
 *    corrupting the user's cost basis (and therefore every P/L figure).
 * 2. useIndices falls back to DEFAULT_INDICES on failure, so App's
 *    `indicesError && indices.length === 0` branch was unreachable and an
 *    unreachable server left users looking at built-in indices with no
 *    indication anything was wrong.
 * 3. useBenchmark wrote lastUpdatedAt from the fetch handlers before the
 *    abort guard, resurrecting stale "last updated" metadata for a benchmark
 *    the user had already switched away from.
 * 4. buildDashboardQuery compared update fields against `null` while the type
 *    only allowed `undefined`, so the parameter-delete branches were dead
 *    code and a stale `index=` survived deselection.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDashboardQuery, parseDashboardParams } from "./navigation";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const benchmarkHookSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useBenchmark.ts"),
  "utf8",
);

describe("handleAddToPortfolio refuses a fabricated cost basis", () => {
  it("never falls back to a hard-coded price", () => {
    // The pre-fix shape: `: 100` as the final branch of the safePrice chain.
    expect(appSource).not.toMatch(/Number\.isFinite\(fund\.price\) && fund\.price > 0\s*\?\s*fund\.price\s*:\s*100/);
  });

  it("aborts the add with an error toast when no valid price exists", () => {
    expect(appSource).toContain("const safePrice =");
    expect(appSource).toContain("if (safePrice === null) {");
    expect(appSource).toMatch(
      /if \(safePrice === null\) \{[\s\S]{0,400}?toastError\(/,
    );
    // The refusal must not reach addPortfolioPosition.
    const refusalBlock = appSource.slice(
      appSource.indexOf("if (safePrice === null) {"),
      appSource.indexOf("addPortfolioPosition({"),
    );
    expect(refusalBlock).toContain("return;");
  });
});

describe("indices list failure is surfaced to the user", () => {
  it("shows a warning toast when the indices fetch fails", () => {
    expect(appSource).toContain("if (indicesError) {");
    expect(appSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(indicesError\) \{\s*toastWarning\(/,
    );
  });

  it("keeps the error state wired from useIndices", () => {
    expect(appSource).toContain("error: indicesError,");
  });
});

describe("useBenchmark does not write lastUpdatedAt after abort", () => {
  it("guards every async lastUpdatedAt write with the abort signal", () => {
    // The two synchronous writes in the effect body (cache hit + reset) run
    // before any request starts and need no guard. Every write that happens
    // inside the async fetch chain must respect the abort signal, otherwise a
    // superseded request resurrects stale "last updated" metadata.
    const fetchChain = benchmarkHookSource.slice(
      benchmarkHookSource.indexOf("fetch(`${API_BASE}/snapshot"),
    );
    const asyncWrites = fetchChain.match(/setLastUpdatedAt\(/g) || [];
    const guardedWrites =
      fetchChain.match(/if \(!controller\.signal\.aborted\) \{[\s\S]*?setLastUpdatedAt\(/g) || [];
    expect(asyncWrites.length).toBeGreaterThan(0);
    expect(guardedWrites.length).toBe(asyncWrites.length);
  });

  it("never publishes an aborted response to the shared benchmark session cache", () => {
    // The module cache feeds the next render, so an aborted request must not
    // write to it either: a superseded response would overwrite a newer
    // payload and be served for the full TTL.
    const cacheWrites = benchmarkHookSource.match(
      /benchmarkSessionCache\.set\(/g,
    ) || [];
    expect(cacheWrites.length).toBeGreaterThan(0);
    const guardedCacheWrites =
      benchmarkHookSource.match(
        /if \(!controller\.signal\.aborted\) \{[\s\S]*?benchmarkSessionCache\.set\(/g,
      ) || [];
    expect(guardedCacheWrites.length).toBe(cacheWrites.length);
  });
});

describe("buildDashboardQuery removes stale params when passed null", () => {
  it("deletes index/bm/tf when the caller explicitly passes null", () => {
    const query = buildDashboardQuery("?index=old&bm=^N225&tf=1M&keep=1", {
      indexId: null,
      benchmark: null,
      timeframe: null,
    });
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    expect(params.has("index")).toBe(false);
    expect(params.has("bm")).toBe(false);
    expect(params.has("tf")).toBe(false);
    // Non-dashboard params survive.
    expect(params.get("keep")).toBe("1");
  });

  it("keeps existing values when a field is undefined and updates when set", () => {
    const kept = buildDashboardQuery("?index=old&tf=1M", {
      indexId: undefined,
      timeframe: "3M",
    });
    const keptParams = new URLSearchParams(kept.slice(1));
    expect(keptParams.get("index")).toBe("old");
    expect(keptParams.get("tf")).toBe("3M");

    const updated = buildDashboardQuery("?index=old", { indexId: "new" });
    expect(new URLSearchParams(updated.slice(1)).get("index")).toBe("new");
  });

  it("round-trips through parseDashboardParams after deletion", () => {
    const query = buildDashboardQuery("?index=old&bm=^N225", { indexId: null });
    expect(parseDashboardParams(query).indexId).toBeUndefined();
  });
});
