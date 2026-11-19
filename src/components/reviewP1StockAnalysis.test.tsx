// @vitest-environment jsdom
/**
 * UI-1 P1-01 / P1-05 / P1-09 regression tests (DOM behaviour).
 * P1-01: a reference (isDemoData) price must never be handed to the portfolio
 *        callback as a purchase cost.
 * P1-05: the search field is a combobox with an active option that arrow keys
 *        move and Enter commits, without breaking plain Enter form submit.
 * P1-09: the watchlist check is confirmed by the add result, not optimistic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StockQuoteFundamentals } from "../lib/marketDataService";

const { fetchScreenerStocks, getCachedStockFundamentals } = vi.hoisted(() => ({
  fetchScreenerStocks: vi.fn(),
  getCachedStockFundamentals: vi.fn(),
}));

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchScreenerStocks, getCachedStockFundamentals };
});

import { StockAnalysisPage } from "./StockAnalysisPage";

function quote(ticker: string, name: string, isDemoData = false): StockQuoteFundamentals {
  return {
    ticker,
    name,
    theme: "自動車",
    sector: "製造",
    market: "PRIME",
    price: 2800,
    change: 10,
    changePercent: 0.4,
    volume: 1000,
    previousClose: 2790,
    dayHigh: 2820,
    dayLow: 2780,
    yearHigh: 3200,
    yearLow: 2000,
    marketCap: 1000000,
    per: 12,
    pbr: 1,
    dividendYield: 2,
    roe: 8,
    equityRatio: 50,
    eps: 200,
    dps: 40,
    sparkline: [2700, 2800],
    technicalSignal: "NEUTRAL",
    historicalFinances: [],
    ...(isDemoData ? { isDemoData: true as const } : {}),
  } as StockQuoteFundamentals;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCachedStockFundamentals.mockImplementation((ticker: string) => quote(ticker, ticker));
  fetchScreenerStocks.mockResolvedValue([quote("7203", "トヨタ", true), quote("6758", "ソニー")]);
});

afterEach(() => {
  cleanup();
});

describe("StockAnalysisPage review P1 fixes", () => {
  it("does not pass a reference price to the portfolio action", async () => {
    const onAddToPortfolio = vi.fn();
    render(
      <StockAnalysisPage
        onNavigate={vi.fn()}
        onOpenStockDetail={vi.fn()}
        onAddToPortfolio={onAddToPortfolio}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "トヨタをポートフォリオに追加" })).toBeTruthy(),
    );
    const demoButton = screen.getByRole("button", { name: "トヨタをポートフォリオに追加" }) as HTMLButtonElement;
    expect(demoButton.disabled).toBe(true);
    fireEvent.click(demoButton);
    expect(onAddToPortfolio).not.toHaveBeenCalled();

    const liveButton = screen.getByRole("button", { name: "ソニーをポートフォリオに追加" }) as HTMLButtonElement;
    expect(liveButton.disabled).toBe(false);
    fireEvent.click(liveButton);
    expect(onAddToPortfolio).toHaveBeenCalledTimes(1);
    expect(onAddToPortfolio.mock.calls[0]?.[0]).toBe("6758");
  });

  it("exposes a combobox whose active option moves with arrow keys and commits on Enter", async () => {
    const onOpenStockDetail = vi.fn();
    render(
      <StockAnalysisPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />,
    );
    const input = screen.getByPlaceholderText(/銘柄コード/);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(input, { target: { value: "ソニー" } });
    expect(input.getAttribute("aria-expanded")).toBe("true");

    const listbox = await screen.findByRole("listbox", { name: "銘柄検索候補" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.id).toBeTruthy();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(options.some((option) => option.id === activeId)).toBe(true);
    expect(options.find((option) => option.id === activeId)?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(1);
    expect(onOpenStockDetail.mock.calls[0]?.[0]).toBe("6758");
  });

  it("keeps the form's plain Enter submit when no option is active", async () => {
    const onOpenStockDetail = vi.fn();
    render(
      <StockAnalysisPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />,
    );
    const input = screen.getByRole("combobox", { name: "銘柄コード・企業名を入力" });
    fireEvent.change(input, { target: { value: "6758" } });
    // jsdom does not synthesize a submit from keyDown; assert that the input
    // did not prevent the form's normal Enter path.
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(onOpenStockDetail).toHaveBeenCalledWith("6758");
  });

  it("only marks a watchlist row added when the caller confirms the write", async () => {
    const onAddToWatchlist = vi.fn().mockResolvedValue(false);
    render(
      <StockAnalysisPage
        onNavigate={vi.fn()}
        onOpenStockDetail={vi.fn()}
        onAddToWatchlist={onAddToWatchlist}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ソニーを監視リストに追加" })).toBeTruthy(),
    );

    const button = screen.getByRole("button", { name: "ソニーを監視リストに追加" });
    expect(button.getAttribute("title")).toBe("監視リストに追加");
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onAddToWatchlist).toHaveBeenCalledWith("6758");
    expect(button.getAttribute("title")).toBe("監視リストに追加");

    onAddToWatchlist.mockResolvedValue(true);
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("title")).toBe("監視リスト追加済み"));
  });

  it("keeps card activation on a real button instead of nesting buttons in a button role", async () => {
    const onOpenStockDetail = vi.fn();
    render(
      <StockAnalysisPage onNavigate={vi.fn()} onOpenStockDetail={onOpenStockDetail} />,
    );
    await waitFor(() => expect(document.querySelector(".stock-analysis-card")).not.toBeNull());

    const card = document.querySelector<HTMLElement>(".stock-analysis-card");
    expect(card?.getAttribute("role")).toBeNull();
    const detail = screen
      .getAllByRole("button", { name: /の詳細を見る/ })
      .find((button) => card?.contains(button) === true);
    expect(detail).toBeDefined();
    fireEvent.click(detail as HTMLElement);
    expect(onOpenStockDetail).toHaveBeenCalledTimes(1);
  });
});
