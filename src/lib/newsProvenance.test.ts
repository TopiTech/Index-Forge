import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  setAllowMemoryCacheInTest,
  clearMemoryCache,
  clearMemoryRateLimits,
  resetLastKnownMarketOverview,
} from "../../worker/internal";
import {
  buildDefaultMarketNews,
  normalizeMarketOverview,
  DEFAULT_MARKET_OVERVIEW,
} from "./marketDataService";
import { FALLBACK_MARKET_NEWS_TEMPLATES } from "../data/marketConstants";

/**
 * N-1 (news provenance) の回帰防止。
 *
 * 合成ニュースには来歴が無く、実在媒体名と「5分前」等の偽装鮮度が付与されて
 * いた。根本原因は「合成値と実測値の区別を型に持たない」ことなので、この
 * スイートは来歴の規律そのものを契約として固定する:
 *
 * - 合成サンプルは `isSample: true`、source は "サンプル"、配信時刻は持たない。
 * - 実記事は配信元が供給した時刻のみを持つ。欠損時に「今」等を捏造しない。
 * - 配信元不明の実記事に媒体名を付与しない。
 * - 境界 (normalizeMarketOverview) はサンプルの時刻を破棄する。
 */

type NewsRow = Record<string, unknown>;

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Yahoo 呼び出しの決定的なテストダブル。ニュース検索だけを差し替え、他の
 * URL は空 JSON を返す (資産価格はフォールバック経路になる)。
 */
function stubYahooNewsSearch(news: unknown[] | "reject"): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/finance/search")) {
      if (news === "reject") {
        throw new TypeError("network down");
      }
      return jsonResponse({ news });
    }
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function fetchOverviewNews(): Promise<NewsRow[]> {
  const res = await worker.fetch(
    new Request("https://example.com/api/market/overview"),
    {} as any,
  );
  expect(res.status).toBe(200);
  const data = (await res.json()) as { news: NewsRow[] };
  expect(Array.isArray(data.news)).toBe(true);
  return data.news;
}

/** 実記事風の媒体名 (合成に付与してはいけない)。 */
const MEDIA_STYLE_SOURCES = ["市場速報", "為替市況", "グローバル金融", "株式ニュース"];

function expectSampleRows(rows: NewsRow[]): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.isSample).toBe(true);
    expect(row.source).toBe("サンプル");
    expect(MEDIA_STYLE_SOURCES).not.toContain(row.source);
    // 偽装鮮度の禁止: 時刻文字列も ISO タイムスタンプも持たない
    expect(row.publishedAt).toBe("");
    expect(row.publishedTimestamp).toBeUndefined();
    expect(String(row.publishedAt)).not.toMatch(/(分前|時間前|日前|たった今|昨日)/);
    expect(String(row.publishedAt)).not.toMatch(/^\d{2}:\d{2}$/);
  }
}

describe("Worker /api/market/overview news provenance (N-1)", () => {
  beforeEach(() => {
    setAllowMemoryCacheInTest(true);
    clearMemoryCache();
    clearMemoryRateLimits();
    resetLastKnownMarketOverview();
  });

  afterEach(() => {
    setAllowMemoryCacheInTest(false);
    clearMemoryCache();
    clearMemoryRateLimits();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("marks the fallback topics as samples without a media name or a fabricated publish time", async () => {
    stubYahooNewsSearch([]);
    expectSampleRows(await fetchOverviewNews());
  });

  it("discloses the samples the same way when the news fetch fails outright", async () => {
    stubYahooNewsSearch("reject");
    expectSampleRows(await fetchOverviewNews());
  });

  it("keeps the provider-supplied publish time for real articles (JST display time + ISO)", async () => {
    // 2026-10-28T05:30:00Z → JST 14:30
    const providerSecs = Date.UTC(2026, 9, 28, 5, 30, 0) / 1000;
    stubYahooNewsSearch([
      {
        uuid: "uuid-real-1",
        title: "実在の配信記事",
        publisher: "テスト通信",
        link: "https://example.com/article",
        providerPublishTime: providerSecs,
        relatedTickers: ["8035"],
      },
    ]);

    const rows = await fetchOverviewNews();
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.isSample).toBeUndefined();
    expect(row.source).toBe("テスト通信");
    expect(row.publishedAt).toBe("14:30");
    expect(row.publishedTimestamp).toBe(new Date(providerSecs * 1000).toISOString());
  });

  it("does not invent a publish time when the provider omits providerPublishTime", async () => {
    stubYahooNewsSearch([
      {
        uuid: "uuid-no-time",
        title: "配信時刻のない実記事",
        publisher: "テスト通信",
        link: "https://example.com/article-2",
        relatedTickers: ["8035"],
      },
    ]);

    const rows = await fetchOverviewNews();
    expect(rows.length).toBe(1);
    // 実記事だが時刻は未取得。捏造せず空とし、サンプルにもしない。
    expect(rows[0].isSample).toBeUndefined();
    expect(rows[0].source).toBe("テスト通信");
    expect(rows[0].publishedAt).toBe("");
    expect(rows[0].publishedTimestamp).toBeUndefined();
  });

  it("does not invent a publisher name when the provider omits it", async () => {
    stubYahooNewsSearch([
      {
        uuid: "uuid-no-publisher",
        title: "配信元不明の実記事",
        publisher: "",
        link: "https://example.com/article-3",
        providerPublishTime: Date.UTC(2026, 9, 28, 5, 30, 0) / 1000,
      },
    ]);

    const rows = await fetchOverviewNews();
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe("配信元不明");
    expect(MEDIA_STYLE_SOURCES).not.toContain(rows[0].source);
  });
});

describe("Client default overview news provenance (N-1)", () => {
  it("flags every default topic as a sample with no time and no media name", () => {
    const rows = buildDefaultMarketNews();
    expectSampleRows(rows as unknown as NewsRow[]);
    expectSampleRows(DEFAULT_MARKET_OVERVIEW.news as unknown as NewsRow[]);
  });

  it("keeps the shared fallback templates free of media-name impersonation", () => {
    expect(FALLBACK_MARKET_NEWS_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of FALLBACK_MARKET_NEWS_TEMPLATES) {
      expect(template.source).toBe("サンプル");
      expect(MEDIA_STYLE_SOURCES).not.toContain(template.source);
    }
  });
});

describe("normalizeMarketOverview news provenance (N-1)", () => {
  const validIndex = {
    symbol: "^N225",
    name: "日経平均",
    category: "INDEX",
    price: 40000,
    change: 100,
    changePercent: 0.25,
    currency: "JPY",
    updatedAt: "15:00 JST",
  };

  it("propagates isSample and discards any time a sample payload smuggles in", () => {
    const normalized = normalizeMarketOverview({
      indices: [validIndex],
      news: [
        {
          id: "s1",
          title: "サンプルトピック",
          source: "市場速報",
          publishedAt: "5分前",
          publishedTimestamp: "2026-10-28T00:00:00.000Z",
          isSample: true,
        },
        {
          id: "r1",
          title: "実際の配信記事",
          source: "テスト通信",
          publishedAt: "10:00",
          publishedTimestamp: "2026-10-28T00:00:00.000Z",
        },
      ],
    });

    expect(normalized).not.toBeNull();
    const [sample, real] = normalized!.news;
    expect(sample.isSample).toBe(true);
    expect(sample.publishedAt).toBe("");
    expect(sample.publishedTimestamp).toBeUndefined();
    expect(real.isSample).toBeUndefined();
    expect(real.publishedAt).toBe("10:00");
    expect(real.publishedTimestamp).toBe("2026-10-28T00:00:00.000Z");
  });

  it("treats isSample strictly as the boolean true", () => {
    const normalized = normalizeMarketOverview({
      indices: [validIndex],
      news: [
        {
          id: "s1",
          title: "真値でないフラグ",
          source: "テスト通信",
          publishedAt: "10:00",
          publishedTimestamp: "2026-10-28T00:00:00.000Z",
          isSample: "true",
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized!.news[0].isSample).toBeUndefined();
    expect(normalized!.news[0].publishedTimestamp).toBe("2026-10-28T00:00:00.000Z");
    expect(normalized!.news[0].publishedAt).toBe("10:00");
  });

  it("still drops news rows that carry no publish date (existing contract)", () => {
    const normalized = normalizeMarketOverview({
      indices: [validIndex],
      news: [
        {
          id: "n-no-date",
          title: "日付のない行",
          source: "テスト通信",
          isSample: true,
        },
        {
          id: "r2",
          title: "通常の実記事",
          source: "テスト通信",
          publishedAt: "11:00",
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized!.news.map((item) => item.id)).toEqual(["r2"]);
  });
});
