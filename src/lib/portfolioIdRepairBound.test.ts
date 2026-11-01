import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY_PORTFOLIO, loadPortfolioPositions } from "./portfolioStorage";

// A deterministic id source makes every repair attempt collide. The loader
// must still terminate and choose the documented suffix fallback.
vi.mock("./randomId", () => ({ safeRandomId: () => "fixed" }));

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded portfolio id repair (G-3)", () => {
  it("falls back to a deterministic suffix instead of looping forever", () => {
    store[STORAGE_KEY_PORTFOLIO] = JSON.stringify([
      { id: "pos-7203-10-fixed", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2500 },
      { id: "pos-7203-10-fixed-2", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2600 },
      { id: "pos-7203-10-fixed", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2700 },
    ]);

    const positions = loadPortfolioPositions();

    expect(positions.map((position) => position.averageCost)).toEqual([2500, 2600, 2700]);
    expect(new Set(positions.map((position) => position.id)).size).toBe(3);
    // The random mint is fixed, so all eight attempts collide. The stored
    // `-2` id is already taken, so the deterministic fallback must skip to -3.
    expect(positions[2].id).toBe("pos-7203-10-fixed-3");
  });

  it("is stable across repeated loads with the same deterministic id source", () => {
    store[STORAGE_KEY_PORTFOLIO] = JSON.stringify([
      { id: "same", ticker: "7203", name: "トヨタ自動車", shares: 10, averageCost: 2500 },
      { id: "same", ticker: "6758", name: "ソニーグループ", shares: 20, averageCost: 3000 },
      { id: "same-2", ticker: "9984", name: "ソフトバンクグループ", shares: 30, averageCost: 4000 },
    ]);

    const first = loadPortfolioPositions().map((position) => position.id);
    const second = loadPortfolioPositions().map((position) => position.id);

    expect(new Set(first).size).toBe(3);
    expect(second).toEqual(first);
  });
});
