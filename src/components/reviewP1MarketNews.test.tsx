// @vitest-environment jsdom
/**
 * UI-1 P1-07: news links are only rendered for HTTPS URLs on an allow-listed
 * origin. Asserted through the DOM (link presence/absence and href).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketOverviewPage } from "./MarketOverviewPage";
import { fetchMarketOverview, type MarketOverviewData } from "../lib/marketDataService";

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchMarketOverview: vi.fn() };
});

const fetchOverview = vi.mocked(fetchMarketOverview);

function overviewWithUrl(url: string): MarketOverviewData {
  return {
    dataSource: "live",
    dataAsOf: "2026-10-24T06:00:00.000Z",
    indices: [],
    forex: [],
    commodities: [],
    crypto: [],
    sectors: [],
    marketBreadth: { gainers: 1, losers: 0, unchanged: 0, sentimentScore: 50 },
    news: [
      {
        id: "n1",
        title: `ニュース ${url}`,
        source: "配信元",
        publishedAt: "10:00",
        url,
      },
    ],
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("MarketOverviewPage news URL validation (P1-07)", () => {
  it.each([
    "javascript:alert(1)",
    "http://finance.yahoo.com/news/insecure",
    "https://attacker.example/news",
    "https://finance.yahoo.com.evil.test/news",
  ])("does not link an untrusted URL (%s)", async (url) => {
    fetchOverview.mockResolvedValue(overviewWithUrl(url));
    renderPage();
    await screen.findByText(`ニュース ${url}`);
    expect(screen.queryByRole("link", { name: /記事原文を新しいタブで開く/ })).toBeNull();
  });

  it("keeps a link for an allowed HTTPS news origin", async () => {
    const url = "https://finance.yahoo.com/news/allowed";
    fetchOverview.mockResolvedValue(overviewWithUrl(url));
    renderPage();
    const link = await screen.findByRole("link", { name: /記事原文を新しいタブで開く/ });
    expect(link.getAttribute("href")).toBe(url);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

function renderPage() {
  return render(<MarketOverviewPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />);
}
