import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLiveMarketCalendarAsync } from "../../worker/internal";

describe("Macro Calendar Live Accuracy and Official Schedules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("marks central bank meeting schedules as official on successful live fetch", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      if (urlStr.includes("fc.yahoo.com")) {
        return new Response("", {
          status: 200,
          headers: { "set-cookie": "A1=mockCookieValue; Path=/; Domain=.yahoo.com;" },
        });
      }
      if (urlStr.includes("getcrumb")) {
        return new Response("mockCrumbValue", { status: 200 });
      }
      if (urlStr.includes("/v7/finance/quote")) {
        return new Response(
          JSON.stringify({
            quoteResponse: {
              result: [
                {
                  symbol: "7203.T",
                  earningsTimestamp: Math.floor(new Date(2026, 0, 18).getTime() / 1000),
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return origFetch(input, init);
    });

    try {
      const refDate = new Date(2026, 0, 15);
      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);

      const boj = events.find((e) => e.id.startsWith("macro-boj"));
      expect(boj).toBeDefined();
      expect(boj?.source).toBe("official");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("fetchLiveMarketCalendarAsync queries ^IRX and ^TNX in quote symbols", async () => {
    const queriedUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      queriedUrls.push(urlStr);
      if (urlStr.includes("fc.yahoo.com")) {
        return new Response("", {
          status: 200,
          headers: { "set-cookie": "A1=mockCookieValue; Path=/; Domain=.yahoo.com;" },
        });
      }
      if (urlStr.includes("getcrumb")) {
        return new Response("mockCrumbValue", { status: 200 });
      }
      if (urlStr.includes("/v7/finance/quote")) {
        return new Response(
          JSON.stringify({
            quoteResponse: {
              result: [
                {
                  symbol: "^IRX",
                  regularMarketPrice: 4.35,
                },
                {
                  symbol: "^TNX",
                  regularMarketPrice: 4.45,
                },
                {
                  symbol: "7203.T",
                  shortName: "トヨタ自動車",
                  earningsTimestamp: Math.floor(new Date(2026, 0, 20).getTime() / 1000),
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return origFetch(input, init);
    });

    try {
      const refDate = new Date(2026, 0, 15);
      const events = await fetchLiveMarketCalendarAsync(undefined, refDate);

      // Verify that quote query included ^IRX and ^TNX
      const quoteCall = queriedUrls.find((u) => u.includes("/v7/finance/quote"));
      expect(quoteCall).toBeDefined();
      expect(quoteCall).toContain("%5EIRX"); // encoded ^IRX
      expect(quoteCall).toContain("%5ETNX"); // encoded ^TNX

      // Verify FOMC event received dynamic rate reflection
      const fomc = events.find((e) => e.id.startsWith("macro-fomc"));
      expect(fomc).toBeDefined();
      expect(fomc?.previous).toContain("4.25% - 4.50%");
      // N-2: 3ヶ月 T-Bill (^IRX) からの推計は公式誘導目標を名乗らない
      expect(fomc?.previous).toContain("参考推計");
      expect(fomc?.previous).not.toContain("現行誘導目標");
      expect(fomc?.forecast).toBe("市場予想集計中");
      // N-2/N-3: イベントの source は日程の来歴 (公定日程 = "official")、
      // 値はフィールド単位の来歴で推計/参考値と区別される。
      expect(fomc?.source).toBe("official");
      expect(fomc?.fieldProvenance?.previous).toBe("estimated");
      expect(fomc?.fieldProvenance?.forecast).toBe("reference");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
