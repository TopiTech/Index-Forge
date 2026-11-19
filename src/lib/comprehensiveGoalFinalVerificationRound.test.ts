import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchSecEdgarFinancials } from "../../worker/internal";
import { getSavedDimensions } from "../components/TradingViewChartModal";

function createStorageMock(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function stubSecEdgarCompanyFacts(facts: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("data.sec.gov")) {
        return new Response(JSON.stringify(facts), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    }),
  );
}

describe("Comprehensive Goal Final Verification Round", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. SEC EDGAR XBRL Multi-Filing & 10-K/A Resolution", () => {
    it("selects the latest amended report (10-K/A) with the newest filed date for the same fiscal year", async () => {
      stubSecEdgarCompanyFacts({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [
                  // Older original 10-K filing for 2023
                  { form: "10-K", fy: 2023, val: 383285000000, fp: "FY", filed: "2023-11-03", end: "2023-09-30" },
                  // Amended 10-K/A filing for 2023 with revised revenue
                  { form: "10-K/A", fy: 2023, val: 385000000000, fp: "FY", filed: "2024-02-15", end: "2023-09-30" },
                  // 2024 10-K filing
                  { form: "10-K", fy: 2024, val: 391035000000, fp: "FY", filed: "2024-11-01", end: "2024-09-30" },
                ],
              },
            },
            NetIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 96995000000, fp: "FY", filed: "2023-11-03", end: "2023-09-30" },
                  { form: "10-K/A", fy: 2023, val: 97500000000, fp: "FY", filed: "2024-02-15", end: "2023-09-30" },
                  { form: "10-K", fy: 2024, val: 93736000000, fp: "FY", filed: "2024-11-01", end: "2024-09-30" },
                ],
              },
            },
            OperatingIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 114301000000, fp: "FY", filed: "2023-11-03", end: "2023-09-30" },
                  { form: "10-K/A", fy: 2023, val: 115000000000, fp: "FY", filed: "2024-02-15", end: "2023-09-30" },
                  { form: "10-K", fy: 2024, val: 123216000000, fp: "FY", filed: "2024-11-01", end: "2024-09-30" },
                ],
              },
            },
            EarningsPerShareDiluted: {
              units: {
                "USD/shares": [
                  { form: "10-K", fy: 2023, val: 6.13, fp: "FY", filed: "2023-11-03", end: "2023-09-30" },
                  { form: "10-K/A", fy: 2023, val: 6.16, fp: "FY", filed: "2024-02-15", end: "2023-09-30" },
                  { form: "10-K", fy: 2024, val: 6.08, fp: "FY", filed: "2024-11-01", end: "2024-09-30" },
                ],
              },
            },
            CommonStockDividendsPerShareDeclared: {
              units: {
                "USD/shares": [
                  { form: "10-K", fy: 2023, val: 0.96, fp: "FY", filed: "2023-11-03", end: "2023-09-30" },
                  { form: "10-K", fy: 2024, val: 1.0, fp: "FY", filed: "2024-11-01", end: "2024-09-30" },
                ],
              },
            },
          },
        },
      });

      const results = await fetchSecEdgarFinancials("AAPL");
      expect(results).toHaveLength(2);

      const fy23 = results.find((r) => r.fiscalYear === "2023 FY");
      expect(fy23).toBeDefined();
      // Should pick the 10-K/A amended values (385,000M rev, 97,500M net, 115,000M op, 6.16 eps)
      expect(fy23!.revenue).toBe(385000);
      expect(fy23!.netIncome).toBe(97500);
      expect(fy23!.operatingIncome).toBe(115000);
      expect(fy23!.eps).toBe(6.16);
      expect(fy23!.dps).toBe(0.96);

      const fy24 = results.find((r) => r.fiscalYear === "2024 FY");
      expect(fy24).toBeDefined();
      expect(fy24!.revenue).toBe(391035);
      expect(fy24!.netIncome).toBe(93736);
      expect(fy24!.operatingIncome).toBe(123216);
      expect(fy24!.eps).toBe(6.08);
      expect(fy24!.dps).toBe(1.0);
    });

    it("correctly handles unsorted array entries from SEC response by date sorting", async () => {
      stubSecEdgarCompanyFacts({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: [
                  // Intentionally inverted order: newer filing first, older filing second
                  { form: "10-K/A", fy: 2023, val: 385000000000, fp: "FY", filed: "2024-05-01", end: "2023-09-30" },
                  { form: "10-K", fy: 2023, val: 380000000000, fp: "FY", filed: "2023-11-01", end: "2023-09-30" },
                ],
              },
            },
            NetIncomeLoss: {
              units: {
                USD: [
                  { form: "10-K", fy: 2023, val: 95000000000, fp: "FY", filed: "2023-11-01", end: "2023-09-30" },
                  { form: "10-K/A", fy: 2023, val: 98000000000, fp: "FY", filed: "2024-05-01", end: "2023-09-30" },
                ],
              },
            },
          },
        },
      });

      const results = await fetchSecEdgarFinancials("AAPL");
      expect(results).toHaveLength(1);
      const fy23 = results[0];
      // Must choose 385000 and 98000 (both from 2024-05-01 filing) regardless of array ordering
      expect(fy23.revenue).toBe(385000);
      expect(fy23.netIncome).toBe(98000);
    });
  });

  describe("2. TradingViewChartModal Dimensions Storage Hardening", () => {
    let mockStorage: Storage;

    beforeEach(() => {
      mockStorage = createStorageMock();
      vi.stubGlobal("localStorage", mockStorage);
      vi.stubGlobal("window", {
        innerWidth: 1440,
        innerHeight: 900,
      });
    });

    it("gracefully falls back when stored value is 'null' or primitive strings", () => {
      mockStorage.setItem("tv_chart_popup_custom_size", "null");
      let dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);

      mockStorage.setItem("tv_chart_popup_custom_size", "12345");
      dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);

      mockStorage.setItem("tv_chart_popup_custom_size", "true");
      dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);

      mockStorage.setItem("tv_chart_popup_custom_size", '["array", 123]');
      dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);
    });

    it("gracefully falls back when width/height are NaN, null or Infinity", () => {
      mockStorage.setItem(
        "tv_chart_popup_custom_size",
        JSON.stringify({ width: null, height: 600 }),
      );
      let dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);

      mockStorage.setItem(
        "tv_chart_popup_custom_size",
        JSON.stringify({ width: 900, height: "not-a-number" }),
      );
      dims = getSavedDimensions();
      expect(dims.width).toBe(880);
      expect(dims.height).toBe(560);
    });

    it("accepts and clamps valid stored dimensions within viewport", () => {
      mockStorage.setItem(
        "tv_chart_popup_custom_size",
        JSON.stringify({ width: 1000, height: 650 }),
      );
      const dims = getSavedDimensions();
      expect(dims.width).toBe(1000);
      expect(dims.height).toBe(650);
    });
  });
});
