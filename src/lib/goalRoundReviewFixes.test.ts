import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import worker, {
  fetchAllTickerQuotes,
  clearAuthCache,
  resetPasswordTableEnsured,
  setAllowMemoryCacheInTest,
} from "../../worker/index";
import { isPriceCacheFresh, MAX_CACHE_CLOCK_SKEW_SECONDS } from "./marketCache";
import { SYSTEM_INDICES as SRC_SYSTEM_INDICES } from "../data/indices";
import { SYSTEM_INDICES as WORKER_SYSTEM_INDICES } from "../../worker/index";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(here, rel), "utf8");

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

function createMockEnv(overrides?: Record<string, unknown>) {
  const prepareMock = vi.fn().mockImplementation((_query: string) => ({
    bind: vi.fn().mockImplementation(() => ({
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ success: true }),
    })),
    all: () => Promise.resolve({ results: [] }),
    run: () => Promise.resolve({ success: true }),
  }));
  return {
    ASSETS: { fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })) },
    DB: { prepare: prepareMock, batch: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe("P1: ticker tape discloses static reference values", () => {
  const tape = readSrc("../components/TradingViewTickerTape.tsx");
  const css = readSrc("../index.css");

  it("marks pre-live prices as reference values in title/aria/suffix", () => {
    expect(tape).toContain("参考値(固定表示)");
    expect(tape).toContain("is-reference");
    expect(tape).toContain("(参考)");
    // Bar-level label must not claim realtime before the first live quote.
    expect(tape).toContain("参考値・固定表示。価格の取得待機中");
  });

  it("dims reference prices via CSS", () => {
    expect(css).toContain(".tv-ticker-price.is-reference");
    expect(css).toContain(".tv-ticker-ref-suffix");
  });

  it("shows 参考値 badge instead of SYNC before live data", () => {
    expect(tape).not.toMatch(/<span>\{isLive \? "LIVE" : "SYNC"\}<\/span>/);
    expect(tape).toContain('"参考値"');
  });
});

describe("P1: ticker-prices flags stale fallbacks instead of badging LIVE", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAllowMemoryCacheInTest(false);
  });

  it("marks static fallbacks stale when Yahoo fails for all symbols", async () => {
    // Fresh Response per call: parallel quote fetches each read their own body.
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ chart: { result: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const quotes = await fetchAllTickerQuotes();
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      expect(q.stale).toBe(true);
    }
  });

  it("serves allStale flag with a short cache TTL on total outage", async () => {
    setAllowMemoryCacheInTest(true);
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ chart: { result: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const env = createMockEnv();
    const res = await worker.fetch(
      new Request("http://localhost/api/ticker-prices", { method: "GET" }),
      env as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { allStale?: boolean; quotes: { stale?: boolean }[] };
    expect(body.allStale).toBe(true);
    for (const q of body.quotes) {
      expect(q.stale).toBe(true);
    }
  });
});

describe("P2: StatsGrid no longer mislabels fallback returns with period", () => {
  const stats = readSrc("../components/StatsGrid.tsx");

  it("gates trends/alpha on defined period metrics", () => {
    expect(stats).toContain('typeof customReturnPct !== "number"');
    expect(stats).toContain('typeof benchmarkReturnPct === "number"');
    expect(stats).not.toContain("fallbackCustomReturnPct");
    expect(stats).not.toContain("fallbackBenchmarkReturnPct");
  });
});

describe("P2: freshness display folds sync warnings in", () => {
  const freshness = readSrc("../components/DataFreshness.tsx");
  const header = readSrc("../components/Header.tsx");

  it("accepts hasSyncWarning and appends a partial-failure note", () => {
    expect(freshness).toContain("hasSyncWarning");
    expect(freshness).toContain("一部銘柄の取得に失敗");
    expect(header).toContain("hasSyncWarning");
  });
});

describe("P2: marketCache bounds future-timestamp freshness", () => {
  it("exposes a 5-minute skew allowance", () => {
    expect(MAX_CACHE_CLOCK_SKEW_SECONDS).toBe(300);
  });

  it("treats small skew as fresh but far-future stamps as stale", () => {
    const now = 1_700_000_000;
    expect(isPriceCacheFresh(now, now + 60)).toBe(true);
    expect(isPriceCacheFresh(now, now + 3600)).toBe(false);
  });
});

describe("P2: SYSTEM_INDICES parity between frontend and worker", () => {
  it("keeps src/data and worker SYSTEM_INDICES identical", () => {
    expect([...WORKER_SYSTEM_INDICES].sort()).toEqual([...SRC_SYSTEM_INDICES].sort());
  });
});

describe("P2/P3: admin name validation and indices weight guard", () => {
  const workerSrc = readSrc("../../worker/index.ts");

  it("rejects overlong names symmetrically on update", () => {
    expect(workerSrc).toContain("ユーザー名/ラベルは1〜100文字で入力してください");
    // No silent truncation remains on the update path.
    expect(workerSrc).not.toContain("params.push(name.trim().slice(0, 100))");
  });

  it("coerces NULL weights instead of emitting NaN", () => {
    expect(workerSrc).toContain("COALESCE(b.weight, 0) AS weight");
    expect(workerSrc).toContain("Number.isFinite(rawWeight) ? rawWeight : 0");
  });
});

describe("P3: accessibility and mobile fixes", () => {
  it("uses group+aria-pressed for the heatmap switcher", () => {
    const heatmap = readSrc("../components/ThemeHeatmap.tsx");
    expect(heatmap).toContain('role="group" aria-label="ヒートマップ表示切替"');
    expect(heatmap).not.toContain('role="tablist" aria-label="ヒートマップ表示切替"');
  });

  it("wires aria-controls and focus restore on the header menu", () => {
    const headerSrc = readSrc("../components/Header.tsx");
    expect(headerSrc).toContain('aria-controls="header-mobile-nav"');
    expect(headerSrc).toContain('id="header-mobile-nav"');
    // Item activation restores focus to the toggle.
    expect(headerSrc).toMatch(/closeMobileMenu[\s\S]{0,300}mobileMenuToggleRef\.current\?\.focus\(\)/);
  });

  it("persists mobile chart resizes against responsive floors", () => {
    const modal = readSrc("../components/TradingViewChartModal.tsx");
    expect(modal).not.toContain("if (width >= 460 && height >= 340 && !isMaximized)");
    expect(modal).toContain("window.innerWidth <= 640 ? 300 : 460");
  });
});
