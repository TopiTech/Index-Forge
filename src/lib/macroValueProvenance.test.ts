import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchLiveMarketCalendarAsync,
  resetYahooCrumbCache,
  resetLastKnownCalendarEvents,
} from "../../worker/internal";
import {
  fetchUpcomingEvents,
  generateUpcomingEvents,
  type CalendarEvent,
} from "./marketDataService";
import { MACRO_METRICS_DEFAULTS } from "../data/macroSchedule";

/**
 * N-2 / N-3 (calendar value provenance) の回帰防止。
 *
 * 根本原因は「provenance がイベント単位であり、フィールド単位でない」こと。
 * 決算実データ 1 件の取得で全イベントが "official" に昇格すると、静的デフォルト
 * の前回値・予想値まで実データに見え、FOMC の ^IRX ベース推計は公式誘導目標を
 * 名乗っていた。このスイートは N-1 と同じ規律を契約として固定する:
 *
 * - 静的デフォルト値 (MACRO_METRICS_DEFAULTS 等) は `fieldProvenance` で
 *   "reference"、^IRX からの推計は "estimated" と明示する。
 * - イベント単位の source 昇格 (fallback → official) は値の来歴を洗浄しない。
 * - 境界 (isValidCalendarEvent) は来歴を既知のキー/区分のみに正規化する。
 */

type FetchStub = (input: RequestInfo | URL) => Promise<Response>;

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...(init || {}),
  });
}

/** Yahoo 一式 (crumb / quote) の決定的テストダブル。 */
function stubYahoo(quoteResults: Array<Record<string, unknown>>): FetchStub {
  const stub: FetchStub = async (input) => {
    const url = String(input);
    if (url.includes("fc.yahoo.com")) {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "A1=test-cookie; Path=/; Domain=.yahoo.com" },
      });
    }
    if (url.includes("getcrumb")) {
      return new Response("test-crumb", { status: 200 });
    }
    if (url.includes("/v7/finance/quote")) {
      return jsonResponse({ quoteResponse: { result: quoteResults } });
    }
    return jsonResponse({});
  };
  vi.stubGlobal("fetch", vi.fn(stub));
  return stub;
}

const REF_DATE = new Date(2026, 9, 12);

describe("Calendar field-level value provenance (N-2 / N-3)", () => {
  beforeEach(() => {
    resetYahooCrumbCache();
    resetLastKnownCalendarEvents();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps static default values as reference even after the schedule is promoted to official", async () => {
    // 決算実データ 1 件のみ (無関係の証拠) でイベントは昇格するが、
    // 静的デフォルトの前回値・予想値は実データに洗浄されてはいけない。
    stubYahoo([
      {
        symbol: "7203.T",
        shortName: "トヨタ自動車",
        earningsTimestamp: Math.floor(REF_DATE.getTime() / 1000) + 86400 * 5,
      },
    ]);

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE);
    const macros = events.filter((e) => e.type === "MACRO");
    expect(macros.length).toBeGreaterThan(0);

    for (const m of macros) {
      // 日程は公定日程として official に昇格している (既存の意図仕様)
      expect(m.source).toBe("official");
      // それでも値は静的デフォルトのまま reference
      expect(m.fieldProvenance?.previous).toBe("reference");
      expect(m.fieldProvenance?.forecast).toBe("reference");
    }

    const boj = macros.find((m) => m.id.startsWith("macro-boj"));
    expect(boj?.previous).toBe(MACRO_METRICS_DEFAULTS.boj.previous);
    expect(boj?.forecast).toBe(MACRO_METRICS_DEFAULTS.boj.forecast);
  });

  it("labels the ^IRX-derived FOMC range as an estimate instead of the official target", async () => {
    // ^IRX 4.35 → 下限 4.25%、上限 4.50% の参考推計
    stubYahoo([
      { symbol: "^IRX", regularMarketPrice: 4.35 },
      { symbol: "^TNX", regularMarketPrice: 4.45 },
    ]);

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE);
    const fomc = events.find((e) => e.id.startsWith("macro-fomc"));
    expect(fomc).toBeDefined();
    expect(fomc?.previous).toContain("4.25% - 4.50%");
    expect(fomc?.previous).toContain("参考推計");
    expect(fomc?.previous).not.toContain("現行誘導目標");
    expect(fomc?.fieldProvenance?.previous).toBe("estimated");
    // 「市場予想集計中」はコンセンサス実データではない
    expect(fomc?.forecast).toBe("市場予想集計中");
    expect(fomc?.fieldProvenance?.forecast).toBe("reference");
  });

  it("keeps the static FOMC default when ^IRX is missing or unusable", async () => {
    // regularMarketPrice が 0 / 負 / 欠損のいずれでも推計を捏造しない
    stubYahoo([
      { symbol: "^IRX", regularMarketPrice: 0 },
      { symbol: "^TNX", regularMarketPrice: -1 },
      { symbol: "7203.T", earningsTimestamp: Math.floor(REF_DATE.getTime() / 1000) + 86400 * 5 },
    ]);

    const events = await fetchLiveMarketCalendarAsync(undefined, REF_DATE);
    const fomc = events.find((e) => e.id.startsWith("macro-fomc"));
    expect(fomc).toBeDefined();
    expect(fomc?.previous).toBe(MACRO_METRICS_DEFAULTS.fomc.previous);
    expect(fomc?.previous).not.toContain("参考推計");
    expect(fomc?.fieldProvenance?.previous).toBe("reference");
    expect(fomc?.fieldProvenance?.forecast).toBe("reference");
  });

  it("marks every client-generated default value as reference", () => {
    const events = generateUpcomingEvents(REF_DATE);
    const macros = events.filter((e) => e.type === "MACRO");
    expect(macros.length).toBeGreaterThan(0);
    for (const m of macros) {
      // クライアント側 generateUpcomingEvents の値も静的デフォルト (GDP の
      // インライン定数を含む) なので、すべて reference でなければならない
      expect(m.fieldProvenance?.previous).toBe("reference");
      expect(m.fieldProvenance?.forecast).toBe("reference");
    }
    // 値を持たない決算イベントには来歴マップが付かない (未設定 = 実データ)
    const earnings = events.filter((e) => e.type === "EARNINGS");
    expect(earnings.length).toBeGreaterThan(0);
    for (const e of earnings) {
      expect(e.fieldProvenance).toBeUndefined();
    }
  });

  describe("boundary normalization (fetchUpcomingEvents)", () => {
    function stubCalendarApi(events: unknown[]): void {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(events)),
      );
    }

    it("keeps only known fields and known provenance values", async () => {
      stubCalendarApi([
        {
          id: "evt-1",
          date: "10/20",
          title: "検証イベント",
          type: "MACRO",
          importance: "HIGH",
          previous: "1.0%",
          forecast: "2.0%",
          fieldProvenance: {
            previous: "estimated",
            forecast: "official", // 未設定と同じ意味の冗長値 -> 正規化で破棄
            bogus: "hacked", // 未知のキー -> 破棄
            actual: "reference",
          },
        },
      ]);

      const events = await fetchUpcomingEvents(true);
      expect(events.length).toBe(1);
      expect(events[0].fieldProvenance).toEqual({
        previous: "estimated",
        actual: "reference",
      });
    });

    it("drops a malformed provenance map entirely (untrusted payload)", async () => {
      stubCalendarApi([
        {
          id: "evt-2",
          date: "10/21",
          title: "形状不正イベント",
          type: "MACRO",
          importance: "HIGH",
          previous: "1.0%",
          fieldProvenance: "not-an-object",
        },
        {
          id: "evt-3",
          date: "10/22",
          title: "空マップイベント",
          type: "MACRO",
          importance: "HIGH",
          previous: "1.0%",
          fieldProvenance: { previous: "official" },
        },
      ]);

      const events = await fetchUpcomingEvents(true);
      expect(events.length).toBe(2);
      for (const e of events) {
        expect(e.fieldProvenance).toBeUndefined();
      }
    });

    it("propagates a valid reference/estimated map unchanged", async () => {
      const provenance: CalendarEvent["fieldProvenance"] = {
        previous: "reference",
        forecast: "estimated",
      };
      stubCalendarApi([
        {
          id: "evt-4",
          date: "10/23",
          title: "正常イベント",
          type: "MACRO",
          importance: "HIGH",
          previous: "1.0%",
          forecast: "2.0%",
          fieldProvenance: provenance,
        },
      ]);

      const events = await fetchUpcomingEvents(true);
      expect(events[0].fieldProvenance).toEqual({
        previous: "reference",
        forecast: "estimated",
      });
    });
  });
});
