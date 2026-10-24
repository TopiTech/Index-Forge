// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketOverviewPage } from "./MarketOverviewPage";
import { FreshnessProvider, useActiveFreshness } from "../contexts/FreshnessContext";
import {
  fetchMarketOverview,
  type MarketAssetQuote,
  type MarketOverviewData,
} from "../lib/marketDataService";

/**
 * Behaviour of the market overview page at its data boundary.
 *
 * These tests replace the source-text assertions that used to pin the same
 * behaviour by grepping `MarketOverviewPage.tsx`: the loading placeholder, the
 * keyboard operation of an asset card, the news item's accessible structure and
 * the freshness/provenance badges. They render the component and observe what
 * a user gets, so a refactor that keeps the behaviour keeps them green while a
 * provenance regression (LIVE over reference data) turns them red.
 */
vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchMarketOverview: vi.fn() };
});

const fetchOverview = vi.mocked(fetchMarketOverview);

function quote(overrides: Partial<MarketAssetQuote> = {}): MarketAssetQuote {
  return {
    symbol: "^N225",
    name: "日経平均",
    category: "INDEX",
    price: 40_000,
    change: 100,
    changePercent: 0.25,
    currency: "JPY",
    updatedAt: "15:00 JST",
    ...overrides,
  };
}

function makeOverview(overrides: Partial<MarketOverviewData> = {}): MarketOverviewData {
  return {
    dataSource: "live",
    dataAsOf: "2026-10-24T06:00:00.000Z",
    indices: [quote()],
    forex: [quote({ symbol: "USDJPY=X", name: "米ドル/円", category: "FX", price: 150.25 })],
    commodities: [],
    crypto: [],
    sectors: [{ name: "電気機器・半導体", changePercent: 1.2, market: "TSE" }],
    marketBreadth: { gainers: 1200, losers: 400, unchanged: 50, sentimentScore: 68 },
    news: [
      {
        id: "n1",
        title: "半導体に追い風",
        source: "テスト通信",
        publishedAt: "1時間前",
        url: "https://example.com/news/1",
        relatedTicker: "8035",
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Reads the freshness the page registered for the market view. */
function FreshnessProbe() {
  const freshness = useActiveFreshness("market");
  return <span data-testid="freshness-updated-at">{String(freshness.updatedAt)}</span>;
}

function renderPageWithFreshness() {
  return render(
    <FreshnessProvider>
      <MarketOverviewPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
      <FreshnessProbe />
    </FreshnessProvider>,
  );
}

function renderPage() {
  const onNavigate = vi.fn();
  const onOpenStockDetail = vi.fn();
  const utils = render(
    <MarketOverviewPage onNavigate={onNavigate} onOpenStockDetail={onOpenStockDetail} />,
  );
  return { ...utils, onNavigate, onOpenStockDetail };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("MarketOverviewPage", () => {
  it("shows the loading placeholder until the overview resolves", async () => {
    const pending = deferred<MarketOverviewData>();
    fetchOverview.mockReturnValue(pending.promise);

    renderPage();

    expect(screen.getByRole("status", { name: "市場データを読み込み中..." })).toBeTruthy();
    // Placeholders, not a bare spinner: the stat grid and the table skeleton
    // give the page its final layout while the request is in flight.
    expect(screen.getByRole("status", { name: "主要指標を読み込み中..." })).toBeTruthy();
    expect(screen.getByRole("status", { name: "テーブルデータを読み込み中..." })).toBeTruthy();
    expect(screen.queryByText("グローバル市場概況")).toBeNull();

    await act(async () => {
      pending.resolve(makeOverview());
      await pending.promise;
    });

    expect(screen.getByRole("heading", { name: "グローバル市場概況" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "市場データを読み込み中..." })).toBeNull();
  });

  it("discloses a reference baseline instead of claiming live data", async () => {
    fetchOverview.mockResolvedValue(makeOverview({ dataSource: "fallback" }));

    renderPage();

    expect(await screen.findByText("参考値 (フォールバック)")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/参考ベースラインデータ（フォールバック）/);
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.queryByText("GLOBAL & TSE REAL-TIME MONITOR")).toBeNull();
  });

  it("badges the individual assets the Worker could not refresh and counts them", async () => {
    fetchOverview.mockResolvedValue(
      makeOverview({
        indices: [
          quote({ symbol: "^N225", name: "日経平均", stale: true }),
          quote({ symbol: "^GSPC", name: "S&P 500", category: "INDEX", currency: "USD" }),
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText("一部参考値 (1)")).toBeTruthy();
    const staleCard = screen.getByLabelText(/日経平均 \(\^N225\) の詳細・チャートを開く/);
    expect(within(staleCard).getByText("参考値")).toBeTruthy();
    const liveCard = screen.getByLabelText(/S&P 500 \(\^GSPC\) の詳細・チャートを開く/);
    expect(within(liveCard).queryByText("参考値")).toBeNull();
    // "mixed" must never be presented as fully live (DATA-03).
    expect(screen.queryByText("LIVE")).toBeNull();
  });

  it("claims LIVE only when every asset came from this request", async () => {
    fetchOverview.mockResolvedValue(makeOverview());

    renderPage();

    expect(await screen.findByText("LIVE")).toBeTruthy();
    expect(screen.queryByText(/一部参考値/)).toBeNull();
    const card = screen.getByLabelText(/日経平均 \(\^N225\) の詳細・チャートを開く/);
    expect(within(card).queryByText("参考値")).toBeNull();
  });

  it("opens the stock detail from an asset card with Enter, Space and a click", async () => {
    fetchOverview.mockResolvedValue(makeOverview());
    const { onOpenStockDetail } = renderPage();

    const card = await screen.findByLabelText(
      /日経平均 \(\^N225\) の詳細・チャートを開く/,
    );

    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpenStockDetail).toHaveBeenLastCalledWith("^N225");

    fireEvent.keyDown(card, { key: " " });
    expect(onOpenStockDetail).toHaveBeenCalledTimes(2);
    expect(onOpenStockDetail).toHaveBeenLastCalledWith("^N225");

    fireEvent.click(card);
    expect(onOpenStockDetail).toHaveBeenCalledTimes(3);
  });

  it("keeps the news title a native button and the article link a safe sibling", async () => {
    fetchOverview.mockResolvedValue(makeOverview());
    const { onOpenStockDetail } = renderPage();

    const title = await screen.findByRole("button", { name: /半導体に追い風/ });
    expect(title.tagName).toBe("BUTTON");

    fireEvent.click(title);
    expect(onOpenStockDetail).toHaveBeenCalledWith("8035");

    const link = screen.getByRole("link", { name: /テスト通信 の記事原文を新しいタブで開く/ });
    expect(link.getAttribute("href")).toBe("https://example.com/news/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The card stays a plain container: the article link must not end up inside
    // another interactive element.
    expect(title.parentElement?.closest("button")).toBeNull();
    expect(link.closest("button")).toBeNull();
  });

  it("reports the payload's dataAsOf, never the render clock", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    fetchOverview.mockResolvedValue(makeOverview({ dataAsOf: "2026-10-24T06:00:00.000Z" }));

    const { rerender } = renderPageWithFreshness();

    await waitFor(() =>
      expect(screen.getByTestId("freshness-updated-at").textContent).toBe(
        "2026-10-24T06:00:00.000Z",
      ),
    );

    // A later render must not replace the provenance with "now": that is what
    // re-triggers the freshness effect and, in turn, the render loop.
    nowSpy.mockReturnValue(2_000);
    rerender(
      <FreshnessProvider>
        <MarketOverviewPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        <FreshnessProbe />
      </FreshnessProvider>,
    );
    expect(screen.getByTestId("freshness-updated-at").textContent).toBe(
      "2026-10-24T06:00:00.000Z",
    );
    nowSpy.mockRestore();
  });

  it("falls back to the fetch completion time when the payload has no dataAsOf", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    fetchOverview.mockResolvedValue(makeOverview({ dataAsOf: undefined }));

    const { rerender } = renderPageWithFreshness();

    await waitFor(() =>
      expect(screen.getByTestId("freshness-updated-at").textContent).toBe("1000"),
    );

    nowSpy.mockReturnValue(5_000);
    rerender(
      <FreshnessProvider>
        <MarketOverviewPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
        <FreshnessProbe />
      </FreshnessProvider>,
    );
    // The timestamp is captured once when the request settled, so it stays put
    // across renders instead of drifting with the clock.
    expect(screen.getByTestId("freshness-updated-at").textContent).toBe("1000");
    nowSpy.mockRestore();
  });

  it("fetches once per mount and never updates state after unmount", async () => {
    const pending = deferred<MarketOverviewData>();
    fetchOverview.mockReturnValue(pending.promise);
    const consoleError = vi.spyOn(console, "error");

    const { rerender, unmount } = renderPage();

    rerender(<MarketOverviewPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);
    expect(fetchOverview).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      pending.resolve(makeOverview());
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
