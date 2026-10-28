// @vitest-environment jsdom
/**
 * Search clipping and tap-target behaviour (N-7 conversion).
 *
 * Replaces the source-string pins in
 * `src/lib/batch3FixesComprehensiveVerification.test.ts` (ISSUE-13 and the
 * inline-style half of ISSUE-16), which pinned implementation text such as
 * `const MAX_SEARCH_RESULTS = 80;` and `minWidth: 44,`. Those pins broke on
 * unrelated refactors while never proving the visible behaviour. The tests
 * below exercise the rendered components instead: the clipping contract
 * ("at most 80 rows plus a guidance message") and the 44px clear-button tap
 * target are asserted on the DOM, so they survive refactors and catch real
 * regressions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddStockModal } from "./AddStockModal";
import { GlobalSearchModal } from "./GlobalSearchModal";
import { SearchInput } from "./ui";

// vi.mock factories are hoisted above regular declarations, so the fixtures
// they close over must be created through vi.hoisted as well.
const { FIXTURE_PRESETS, FIXTURE_UNIVERSE } = vi.hoisted(() => {
  /** 85 fixture presets so the 80-row clip and the guidance message engage. */
  const presets = Array.from({ length: 85 }, (_, i) => ({
    ticker: `TK${String(i + 1).padStart(2, "0")}`,
    name: `テスト銘柄${i + 1}`,
    theme: "テスト",
  }));
  /** 100 fixture universe rows for the GlobalSearchModal result list. */
  const universe = Array.from({ length: 100 }, (_, i) => ({
    id: `R${String(i + 1).padStart(3, "0")}`,
    ticker: `R${String(i + 1).padStart(3, "0")}`,
    name: `検索銘柄${i + 1}`,
    market: "TSE" as const,
  }));
  return { FIXTURE_PRESETS: presets, FIXTURE_UNIVERSE: universe };
});

vi.mock("../data/popularStocks", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    PRESET_STOCKS: FIXTURE_PRESETS,
    POPULAR_STOCKS: FIXTURE_PRESETS,
  };
});

vi.mock("../data/stockUniverse", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    ALL_UNIVERSE_STOCKS: FIXTURE_UNIVERSE,
    // The modal maps raw universe rows itself, so return them as-is.
    searchStockUniverse: () => FIXTURE_UNIVERSE,
    getUniverseStockByTicker: (ticker: string) =>
      FIXTURE_UNIVERSE.find((row) => row.ticker === ticker),
  };
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // jsdom does not implement scrollIntoView (called by the result list's
  // keyboard-selection effect).
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ISSUE-13: search result clipping (MAX_SEARCH_RESULTS)", () => {
  it("clips AddStockModal presets to 80 rows and shows the guidance message", () => {
    render(
      <AddStockModal
        isOpen
        onClose={() => {}}
        indexName="テスト指数"
        currentCount={0}
        maxStocks={50}
        onAddStock={async () => ({ ok: true })}
      />,
    );

    // 80 of the 85 fixture presets are listed; the 81st is not.
    expect(screen.getByText("TK80")).toBeTruthy();
    expect(screen.queryByText("TK81")).toBeNull();
    expect(screen.getByText("他 5 件... 検索条件を絞り込んでください")).toBeTruthy();
  });

  it("clips GlobalSearchModal results to 80 rows and shows the guidance message", () => {
    render(<GlobalSearchModal isOpen onClose={() => {}} onNavigate={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText(/銘柄名、コード/),
      { target: { value: "検索銘柄" } },
    );

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(80);
    // Fixture rows 81-100 are clipped away; the message counts them.
    expect(screen.queryByText("検索銘柄81")).toBeNull();
    expect(screen.getByText("他 20 件... 検索条件を絞り込んでください")).toBeTruthy();
  });
});

describe("ISSUE-16: SearchInput clear button 44px tap target", () => {
  it("gives the clear button a 44px minimum tap target and reserves its space", () => {
    render(<SearchInput value="7203" onChange={() => {}} />);

    const clearButton = screen.getByLabelText("検索キーワードを消去");
    expect(clearButton.style.minWidth).toBe("44px");
    expect(clearButton.style.minHeight).toBe("44px");
    // The input reserves the button's width so the text never sits under it.
    const input = screen.getByPlaceholderText("検索...");
    expect(input.style.paddingRight).toBe("44px");
  });
});
