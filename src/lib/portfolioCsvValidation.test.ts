import { describe, expect, it } from "vitest";
import {
  deserializeBasketFromCsv,
  deserializePortfolioFromCsv,
  parseNumericValue,
  serializePortfolioToCsv,
} from "./indexSerialization";
import type { PortfolioPosition } from "./portfolioStorage";

/**
 * Data-layer contract for CSV portfolio import.
 *
 * The importer must never turn a malformed numeric cell into a fabricated
 * holding. Before this contract, missing/NaN/Infinity/negative/zero values
 * became 100 shares and/or a 1000 cost basis, so a corrupt file silently
 * produced fake positions, valuation and P&L.
 */

const HEADER = "コード,銘柄名,保有株数,取得単価,取得日,メモ";

describe("portfolio CSV import numeric validation", () => {
  it("skips NaN, Infinity, negative and missing numeric rows instead of inventing 100/1000", () => {
    const csv = [
      HEADER,
      "7203,トヨタ自動車,abc,2500,2026-01-01,missing shares",
      "6758,ソニーグループ,100,Infinity,2026-01-01,infinite cost",
      "9984,ソフトバンクグループ,-5,8500,2026-01-01,negative shares",
      "8035,東京エレクトロン,10,-1,2026-01-01,negative cost",
      "8058,三菱商事,300,2680,2026-01-01,valid",
    ].join("\n");

    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).toMatchObject({
      ticker: "8058",
      shares: 300,
      averageCost: 2680,
    });
    expect(result.error).toContain("4行をスキップしました");
    expect(result.error).toContain("2, 3, 4, 5");
  });

  it("skips a zero-cost row rather than fabricating a 1000 cost basis", () => {
    const csv = [
      HEADER,
      "7203,トヨタ自動車,100,0,2026-01-01,無償譲渡株",
      "9984,ソフトバンクグループ,50,8500,2026-01-01,通常保有",
    ].join("\n");

    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].ticker).toBe("9984");
    expect(result.data?.[0].averageCost).toBe(8500);
    expect(result.error).toContain("1行をスキップしました");
    expect(result.error).toContain("行: 2");
  });

  it("rejects a file when every data row has an invalid numeric field", () => {
    const csv = [
      HEADER,
      "7203,トヨタ自動車,0,2500,2026-01-01,zero shares",
      "6758,ソニーグループ,100,NaN,2026-01-01,NaN cost",
    ].join("\n");

    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("有効な保有銘柄行が見つかりませんでした");
    expect(result.error).toContain("2, 3");
    expect(result.data).toBeUndefined();
  });

  it("rejects trailing garbage and overflow instead of parseFloat truncation", () => {
    expect(parseNumericValue("12abc")).toBeNaN();
    expect(parseNumericValue("100円")).toBeNaN();
    expect(parseNumericValue("1e309")).toBeNaN();
    expect(parseNumericValue("Infinity")).toBeNaN();
    expect(parseNumericValue("-0")).toBe(0);
    // The generic parser has no field context, so it stays strict about
    // trailing units; portfolio importers opt into their own vocabulary below.
    expect(parseNumericValue("100株")).toBeNaN();
    // Existing supported formats must keep working.
    expect(parseNumericValue("１，５００．７５")).toBe(1500.75);
    expect(parseNumericValue("¥ 5,000")).toBe(5000);
  });

  it("accepts the explicitly documented portfolio units and still rejects ambiguous text", () => {
    const shareOptions = { allowedSuffixes: ["株"] };
    const costOptions = { allowedSuffixes: ["円", "JPY", "ドル", "USD", "米ドル"] };

    expect(parseNumericValue("100株", shareOptions)).toBe(100);
    expect(parseNumericValue("１００株", shareOptions)).toBe(100);
    expect(parseNumericValue("2,500円", costOptions)).toBe(2500);
    expect(parseNumericValue("120 USD", costOptions)).toBe(120);
    expect(parseNumericValue("120 米ドル", costOptions)).toBe(120);
    expect(parseNumericValue("120JPY", costOptions)).toBe(120);

    expect(parseNumericValue("100円", shareOptions)).toBeNaN();
    expect(parseNumericValue("100株", costOptions)).toBeNaN();
    expect(parseNumericValue("100株abc", shareOptions)).toBeNaN();
    expect(parseNumericValue("100円円", costOptions)).toBeNaN();
    expect(parseNumericValue("約100", shareOptions)).toBeNaN();
  });

  it("validates thousands grouping instead of deleting separators", () => {
    expect(parseNumericValue("1,000")).toBe(1000);
    expect(parseNumericValue("1,000,000")).toBe(1000000);
    expect(parseNumericValue("1,000.75")).toBe(1000.75);
    expect(parseNumericValue("¥1,000")).toBe(1000);

    // The sign may precede or follow the currency prefix; both forms keep
    // their sign. Portfolio invariants still reject the negative row later.
    expect(parseNumericValue("-¥5,000")).toBe(-5000);
    expect(parseNumericValue("¥-5,000")).toBe(-5000);
    expect(parseNumericValue("+¥5,000")).toBe(5000);
    expect(parseNumericValue("$-1,000.50")).toBe(-1000.5);
    expect(parseNumericValue("- $ 1,000")).toBe(-1000);

    expect(parseNumericValue("1,2,3")).toBeNaN();
    expect(parseNumericValue("2,50,0")).toBeNaN();
    expect(parseNumericValue("1,0000")).toBeNaN();
    expect(parseNumericValue("1.000,5")).toBeNaN();
    expect(parseNumericValue("1$2")).toBeNaN();
    expect(parseNumericValue("1 000")).toBeNaN();
    expect(parseNumericValue("100¥")).toBeNaN();
    expect(parseNumericValue("¥¥100")).toBeNaN();
    expect(parseNumericValue("$--100")).toBeNaN();
    expect(parseNumericValue("100USD", { allowedSuffixes: ["株"] })).toBeNaN();
  });

  it("accepts percent-suffixed basket weights and preserves bare weights", () => {
    const csv = ["コード,銘柄名,テーマ,比率(%)", "7203,トヨタ自動車,自動車,25%", "6758,ソニーグループ,電機,２５％", "9984,ソフトバンクグループ,通信,50"].join("\n");
    const result = deserializeBasketFromCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data.map((item) => item.weight)).toEqual([25, 25, 50]);
  });

  it("imports unit-suffixed rows and reports the ambiguous row with the accepted notation", () => {
    const csv = [
      HEADER,
      '7203,トヨタ自動車,100株,"2,500円",2026-01-01,valid units',
      "6758,ソニーグループ,約100,3000円,2026-01-01,ambiguous value",
      '9984,ソフトバンクグループ,50,"8,500円",2026-01-01,spaced units',
    ].join("\n");

    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ ticker: "7203", shares: 100, averageCost: 2500 });
    expect(result.data[1]).toMatchObject({ ticker: "9984", shares: 50, averageCost: 8500 });
    expect(result.error).toContain("1行をスキップしました");
    expect(result.error).toContain("スキップした行: 3");
  });

  it("round-trips the serializer's numeric forms, including exponent and precision boundaries", () => {
    const values = [
      1,
      0.1,
      0.30000000000000004,
      1e-7,
      Number.EPSILON,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      1e21,
      Number.MAX_VALUE,
    ];
    // Deterministic property sweep: every combination below is written by
    // `String(value)` (plain decimal or exponent form) and must return exactly.
    for (let exponent = -12; exponent <= 12; exponent += 1) {
      for (const factor of [1, 2.5, 9.75]) {
        const value = factor * 10 ** exponent;
        if (Number.isFinite(value) && value > 0) values.push(value);
      }
    }
    const tickers = ["7203", "6758", "9984", "8035", "8058", "8306", "4063", "6501", "4502"];
    const positions: PortfolioPosition[] = values.map((value, index) => ({
      id: `pos-roundtrip-${index}`,
      ticker: tickers[index % tickers.length],
      name: `round-trip ${index}`,
      shares: value,
      averageCost: values[(index + 3) % values.length],
    }));

    // The UI prepends a UTF-8 BOM before download; the importer must accept
    // exactly what the app itself writes, including scientific notation.
    const csv = "\uFEFF" + serializePortfolioToCsv(positions);
    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toHaveLength(positions.length);
    expect(result.error).toBeUndefined();

    for (let index = 0; index < positions.length; index += 1) {
      expect(result.data[index].shares, `shares[${index}]`).toBe(positions[index].shares);
      expect(result.data[index].averageCost, `averageCost[${index}]`).toBe(
        positions[index].averageCost,
      );
    }
  });

  it("reports a completely unresolved shares/cost column instead of importing defaults", () => {
    const csv = [
      "コード,銘柄名,取得日,メモ",
      "7203,トヨタ自動車,2026-01-01,shares and cost columns absent",
    ].join("\n");

    const result = deserializePortfolioFromCsv(csv);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("有効な保有銘柄行が見つかりませんでした");
    expect(result.error).toContain("行: 2");
  });
});
