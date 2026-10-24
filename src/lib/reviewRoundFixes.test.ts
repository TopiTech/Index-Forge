import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchSecEdgarFinancials } from "../../worker/internal";
import { calculateStockDetails } from "./analytics";
import { escapeCsvCell, parseCsv } from "./csv";
import {
  deserializeIndexFromJson,
  serializeIndexToJson,
} from "./indexSerialization";
import {
  calculateConstituentPerformance,
  calculatePeriodReturns,
} from "../hooks/useSimulation";
import { getSectorAveragePer } from "./marketDataService";
import { todayJstDateString } from "./portfolioStorage";
import type { BasketItem, PricePoint, StockSeries } from "../types";
import type { CustomIndex } from "../data/indices";

const workerSrc = readFileSync(resolve(__dirname, "../../worker/internal-impl.ts"), "utf8");

function mockSecFacts(facts: Record<string, unknown>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    if (String(input).includes("data.sec.gov")) {
      return new Response(JSON.stringify({ facts: { "us-gaap": facts } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("SEC EDGAR fallback accuracy fixes", () => {
  it("reads EPS from the real SEC unit key USD/shares instead of USD", async () => {
    const restore = mockSecFacts({
      Revenues: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 391035000000 }] },
      },
      NetIncomeLoss: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 96995000000 }] },
      },
      EarningsPerShareDiluted: {
        // SEC companyfacts exposes per-share concepts under "USD/shares".
        units: { "USD/shares": [{ form: "10-K", fy: 2024, val: 6.08 }] },
      },
    });
    try {
      const finances = await fetchSecEdgarFinancials("AAPL");
      expect(finances).toHaveLength(1);
      expect(finances[0].eps).toBe(6.08);
    } finally {
      restore();
    }
  });

  it("keeps reading EPS from a normalized USD unit key as a fallback", async () => {
    const restore = mockSecFacts({
      Revenues: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 1000000000 }] },
      },
      EarningsPerShareDiluted: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 1.23 }] },
      },
    });
    try {
      const finances = await fetchSecEdgarFinancials("AAPL");
      expect(finances[0].eps).toBe(1.23);
    } finally {
      restore();
    }
  });

  it("does not fabricate operating income as net * 1.25 when the 10-K fact is missing", async () => {
    const restore = mockSecFacts({
      Revenues: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 1000000000 }] },
      },
      NetIncomeLoss: {
        units: { USD: [{ form: "10-K", fy: 2024, val: 400000000 }] },
      },
    });
    try {
      const finances = await fetchSecEdgarFinancials("AAPL");
      expect(finances[0].netIncome).toBe(400);
      // 捏造値 500 (= 400 * 1.25) ではなく純利益をそのまま代用する
      expect(finances[0].operatingIncome).toBe(finances[0].netIncome);
    } finally {
      restore();
    }
  });

  it("keeps the worker free of the net * 1.25 fabrication and the fabricated cache hit ratio", () => {
    expect(workerSrc).not.toContain("Math.round(net * 1.25)");
    expect(workerSrc).not.toContain('"98.5%"');
  });
});

describe("worker sort_order default consistency", () => {
  it("materializes new indices with the schema default 99 instead of 50", () => {
    expect(workerSrc).toContain("COALESCE(?, (SELECT sort_order FROM indices WHERE id = ?), 99)");
    expect(workerSrc).not.toContain("50 AS sort_order");
    expect(workerSrc).not.toContain("? rawSort : 50");
  });
});

describe("calculateStockDetails ticker normalization", () => {
  const universe: StockSeries[] = [
    {
      ticker: "7203",
      name: "トヨタ自動車",
      theme: "車",
      sector: "輸送用機器",
      latestPrice: 2500,
      series: [
        { date: "2024-01-04", close: 2000 },
        { date: "2024-01-05", close: 2500 },
      ],
    },
  ];

  it("matches full-width basket tickers against ASCII universe tickers", () => {
    const basket: BasketItem[] = [
      { ticker: "７２０３", name: "トヨタ自動車", theme: "車", weight: 100 },
    ];
    const details = calculateStockDetails(basket, universe, 1000);
    expect(details).toHaveLength(1);
    expect(details[0].currentPrice).toBe(2500);
    expect(details[0].change).toBe(500);
    expect(details[0].contributionPt).not.toBe(0);
  });
});

describe("CSV round-trip fidelity", () => {
  it("preserves a leading apostrophe not followed by a formula character", () => {
    const exported = escapeCsvCell("'Tis the season");
    expect(parseCsv(exported)).toEqual([["'Tis the season"]]);
  });

  it("still strips the formula-guard apostrophe added by the exporter", () => {
    expect(parseCsv(escapeCsvCell("+SUM(A1:A2)"))).toEqual([["+SUM(A1:A2)"]]);
    expect(parseCsv(escapeCsvCell("-foo"))).toEqual([["-foo"]]);
  });

  it("round-trips whitespace-prefixed formula chars (the exporter guards them too)", () => {
    // escapeCsvCell は空白を挟んだ数式文字にもガードを付ける。除去側も
    // 同じパターンで対応しないと "'" が残留する。
    expect(parseCsv(escapeCsvCell(" =1+1"))).toEqual([[" =1+1"]]);
    expect(parseCsv(escapeCsvCell("\uFEFF=1+1"))).toEqual([["\uFEFF=1+1"]]);
  });

  it("preserves intentional whitespace inside quoted fields (RFC 4180)", () => {
    expect(parseCsv('" padded "')).toEqual([[" padded "]]);
    expect(parseCsv('unquoted ')).toEqual([["unquoted"]]);
  });
});

describe("index JSON export/import round-trip", () => {
  it("keeps sortOrder across serialize/deserialize", () => {
    const index: CustomIndex = {
      id: "custom-1",
      name: "テスト指数",
      description: "説明",
      baseValue: 1000,
      sortOrder: 7,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "車", weight: 100 }],
    };
    const restored = deserializeIndexFromJson(serializeIndexToJson(index));
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.data.sortOrder).toBe(7);
    }
  });

  it("omits sortOrder when the source has none (legacy format compatibility)", () => {
    const index: CustomIndex = {
      id: "custom-2",
      name: "テスト指数2",
      description: "",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "車", weight: 100 }],
    };
    const json = serializeIndexToJson(index);
    expect(json).not.toContain("sortOrder");
    const restored = deserializeIndexFromJson(json);
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.data.sortOrder).toBeUndefined();
    }
  });

  it("repairs out-of-range sortOrder into the worker contract (0..9999 integer)", () => {
    const base = {
      id: "custom-3",
      name: "テスト指数3",
      description: "",
      baseValue: 1000,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "車", weight: 100 }],
    };
    const negative = deserializeIndexFromJson(JSON.stringify({ ...base, sortOrder: -1 }));
    expect(negative.ok).toBe(true);
    if (negative.ok) expect(negative.data.sortOrder).toBe(0);

    const huge = deserializeIndexFromJson(JSON.stringify({ ...base, sortOrder: 20000 }));
    expect(huge.ok).toBe(true);
    if (huge.ok) expect(huge.data.sortOrder).toBe(9999);

    const fractional = deserializeIndexFromJson(JSON.stringify({ ...base, sortOrder: 3.7 }));
    expect(fractional.ok).toBe(true);
    if (fractional.ok) expect(fractional.data.sortOrder).toBe(3);
  });
});

describe("simulation metric guards", () => {
  it("reports zeros instead of a negated benchmark when the custom series is not measurable", () => {
    const custom: PricePoint[] = [{ date: "2024-01-02", close: 100 }];
    const benchmark: PricePoint[] = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 110 },
      { date: "2024-01-03", close: 120 },
    ];
    const res = calculatePeriodReturns(custom, benchmark);
    expect(res.periodCustomReturnPct).toBe(0);
    expect(res.periodBenchmarkReturnPct).toBe(0);
    expect(res.alphaPct).toBe(0);
    expect(Number.isFinite(res.alphaPct)).toBe(true);
  });

  it("does not leak NaN or -100% when an endpoint value is missing/non-finite", () => {
    const broken: PricePoint[] = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: Number.NaN },
    ];
    const res = calculatePeriodReturns(broken, []);
    expect(res.periodCustomReturnPct).toBe(0);
    expect(Number.isFinite(res.periodCustomReturnPct)).toBe(true);

    const nullEnd = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: null },
    ] as unknown as PricePoint[];
    const res2 = calculatePeriodReturns(nullEnd, []);
    expect(res2.periodCustomReturnPct).toBe(0);
  });

  it("guards constituent returns against non-finite closes", () => {
    const basket: BasketItem[] = [{ ticker: "7203", name: "トヨタ", theme: "車", weight: 100 }];
    const universe: StockSeries[] = [
      {
        ticker: "7203",
        name: "トヨタ自動車",
        theme: "車",
        sector: "輸送用機器",
        latestPrice: Number.NaN,
        series: [
          { date: "2024-01-04", close: 100 },
          { date: "2024-01-05", close: Number.NaN },
        ],
      },
    ];
    const perf = calculateConstituentPerformance(basket, universe, "1M");
    expect(perf).toHaveLength(1);
    expect(perf[0].periodReturnPct).toBe(0);
    expect(Number.isFinite(perf[0].contributionPct)).toBe(true);
  });
});

describe("getSectorAveragePer specificity", () => {
  it("prefers the most specific matching key over generic prefixes", () => {
    expect(getSectorAveragePer("半導体検査")).toBe(30.0);
    expect(getSectorAveragePer("半導体")).toBe(32.5);
  });
});

describe("JST acquisition date", () => {
  it("formats today as YYYY-MM-DD", () => {
    expect(todayJstDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is used instead of the UTC ISO date at both add-position call sites", () => {
    const appSrc = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    const portfolioSrc = readFileSync(
      resolve(__dirname, "../components/PortfolioManagerPage.tsx"),
      "utf8",
    );
    expect(appSrc).toContain("acquiredAt: todayJstDateString()");
    expect(portfolioSrc).toContain("acquiredAt: todayJstDateString()");
  });
});

describe("render-time stability and updater purity", () => {
  it("keeps freshness registration timestamps stable across renders", () => {
    const builderSrc = readFileSync(
      resolve(__dirname, "../components/IndexBuilderPage.tsx"),
      "utf8",
    );
    // 毎レンダーの Date.now() は FreshnessContext と再レンダーループする
    expect(builderSrc).not.toContain("updatedAt: Date.now()");
  });

  it("keeps localStorage writes out of the sidebar toggle updater", () => {
    const appSrc = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    expect(appSrc).not.toContain('localStorage.setItem("indexforge:sidebar:collapsed", String(next))');
    expect(appSrc).toContain('localStorage.setItem("indexforge:sidebar:collapsed", String(isDesktopSidebarCollapsed))');
  });
});
