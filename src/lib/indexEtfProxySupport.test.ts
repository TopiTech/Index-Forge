import { describe, it, expect } from "vitest";
import { BASELINE_ASSET_QUOTES } from "../data/marketConstants";
import { OVERVIEW_ASSET_DEFS, fetchLiveStockFundamentals } from "../../worker/internal-impl";

describe("Index ETF Proxy Support (TOPIX: 1308.T, TOPIX Growth 250: 2516.T)", () => {
  it("maps ^TOPX to 1308.T and ^TOPIXG to 2516.T in BASELINE_ASSET_QUOTES", () => {
    const topix = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPX");
    expect(topix).toBeDefined();
    expect(topix!.querySymbol).toBe("1308.T");
    expect(topix!.category).toBe("INDEX");
    expect(topix!.currency).toBe("JPY");

    const growth = BASELINE_ASSET_QUOTES.find((a) => a.symbol === "^TOPIXG");
    expect(growth).toBeDefined();
    expect(growth!.querySymbol).toBe("2516.T");
    expect(growth!.category).toBe("INDEX");
    expect(growth!.currency).toBe("JPY");
  });

  it("propagates proxy querySymbols to OVERVIEW_ASSET_DEFS in worker", () => {
    const topixDef = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^TOPX");
    expect(topixDef).toBeDefined();
    expect(topixDef!.querySymbol).toBe("1308.T");

    const growthDef = OVERVIEW_ASSET_DEFS.find((d) => d.symbol === "^TOPIXG");
    expect(growthDef).toBeDefined();
    expect(growthDef!.querySymbol).toBe("2516.T");
  });

  it("resolves baseline proxy asset in fetchLiveStockFundamentals for ^TOPX", async () => {
    // When fetchLiveStockFundamentals is queried with ^TOPX, it should use the baseline proxy
    const data = await fetchLiveStockFundamentals("^TOPX");
    expect(data).toBeDefined();
    expect(data.name).toContain("TOPIX");
    expect(data.price).toBeGreaterThan(0);
    expect(Number.isFinite(data.change)).toBe(true);
  });

  it("resolves baseline proxy asset in fetchLiveStockFundamentals for ^TOPIXG", async () => {
    const data = await fetchLiveStockFundamentals("^TOPIXG");
    expect(data).toBeDefined();
    expect(data.name).toContain("東証グロース250");
    expect(data.price).toBeGreaterThan(0);
    expect(Number.isFinite(data.change)).toBe(true);
  });
});
