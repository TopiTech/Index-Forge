/**
 * Regression guard for the useSimulation refetch loop.
 *
 * When the calculation API returned a stockUniverse entry with an empty series
 * for one of the basket tickers (e.g. an unsupported ticker), the effect could
 * never satisfy the "all tickers have data" check. Every response replaced
 * stockUniverse with a new array, which re-ran the effect and re-armed the
 * fetch, producing an unbounded ~4 req/s storm against /api/calculate and
 * /api/sync-prices.
 *
 * The decision logic is extracted into decideSimulationEffectAction so the
 * contract is testable without rendering the hook.
 */
import { describe, expect, it } from "vitest";
import { decideSimulationEffectAction } from "./useSimulation";

describe("decideSimulationEffectAction", () => {
  it("clears when the basket is empty", () => {
    expect(decideSimulationEffectAction(0, "", "", 0)).toBe("clear");
    expect(decideSimulationEffectAction(0, "7203", "", 5)).toBe("clear");
  });

  it("fetches when the ticker set changed", () => {
    expect(decideSimulationEffectAction(2, "7203", "7203,9984", 1)).toBe("fetch");
    expect(decideSimulationEffectAction(1, "", "7203", 0)).toBe("fetch");
  });

  it("recomputes in memory when the ticker set was already fetched", () => {
    // Weight-only change with complete data.
    expect(decideSimulationEffectAction(2, "7203,9984", "7203,9984", 2)).toBe("recompute");
    // A constituent without price rows must NOT schedule another fetch: the
    // response replaced stockUniverse and re-triggered the effect forever.
    expect(decideSimulationEffectAction(2, "7203,9984", "7203,9984", 2)).not.toBe("fetch");
  });

  it("idles instead of looping when the fetched universe is empty", () => {
    expect(decideSimulationEffectAction(1, "7203", "7203", 0)).toBe("idle");
  });
});
