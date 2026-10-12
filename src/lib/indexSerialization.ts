/**
 * Index & Portfolio Serialization & Diversification Analytics
 *
 * 独自指数のJSON/CSVエクスポート・インポート、ポートフォリオのCSV入出力、
 * およびHHI (ハーフィンダール・ハーシュマン指数) による分散度評価。
 */

import type { BasketItem } from "../types";
import type { CustomIndex } from "../data/indices";
import type { PortfolioPosition } from "./portfolioStorage";
import { escapeCsvCell } from "./csv";

export type SerializationResult<T> =
  | { ok: true; data: T; error?: string }
  | { ok: false; error: string; data?: undefined };

export interface DiversificationScore {
  hhi: number;
  level: "HIGH" | "MODERATE" | "CONCENTRATED";
  label: string;
  effectiveConstituentCount: number;
}

/**
 * HHI (Herfindahl-Hirschman Index) による構成銘柄の集中度・分散度スコアを計算。
 * 各銘柄の構成比率 (パーセント: 0〜100) の二乗和を算出 (0〜10000)。
 * - HHI < 1500: 高度に分散 (有効銘柄数多数)
 * - 1500 <= HHI <= 2500: 中程度の分散
 * - HHI > 2500: 特定銘柄への集中度が高い
 */
export function calculateDiversificationScore(weights: readonly number[]): DiversificationScore {
  const validWeights = weights.filter((w) => Number.isFinite(w) && w > 0);
  if (validWeights.length === 0) {
    return {
      hhi: 10000,
      level: "CONCENTRATED",
      label: "未構成",
      effectiveConstituentCount: 0,
    };
  }

  const sum = validWeights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    return {
      hhi: 10000,
      level: "CONCENTRATED",
      label: "未構成",
      effectiveConstituentCount: 0,
    };
  }

  // 100%基準に正規化して二乗和を算出
  const normalizedPercentages = validWeights.map((w) => (w / sum) * 100);
  const hhi = Math.round(normalizedPercentages.reduce((acc, pct) => acc + pct * pct, 0));

  // 有効銘柄数 (Effective Number of Constituents: 10000 / HHI)
  const effectiveConstituentCount = hhi > 0 ? Number((10000 / hhi).toFixed(1)) : 0;

  if (hhi < 1500) {
    return {
      hhi,
      level: "HIGH",
      label: "高度に分散",
      effectiveConstituentCount,
    };
  } else if (hhi <= 2500) {
    return {
      hhi,
      level: "MODERATE",
      label: "適度に分散",
      effectiveConstituentCount,
    };
  } else {
    return {
      hhi,
      level: "CONCENTRATED",
      label: "特定銘柄に集中",
      effectiveConstituentCount,
    };
  }
}

/**
 * 独自指数定義オブジェクトを整形されたJSON文字列にシリアライズします。
 */
export function serializeIndexToJson(index: CustomIndex): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      id: index.id,
      name: index.name,
      description: index.description,
      baseValue: index.baseValue,
      basket: index.basket.map((b) => ({
        ticker: b.ticker,
        name: b.name,
        theme: b.theme,
        weight: b.weight,
      })),
    },
    null,
    2,
  );
}

/**
 * JSON文字列をパースし、有効なCustomIndexオブジェクトか厳密に検証します。
 */
export function deserializeIndexFromJson(jsonStr: string): SerializationResult<CustomIndex> {
  const stripped = typeof jsonStr === "string" ? jsonStr.replace(/^\uFEFF/, "") : "";
  if (!stripped || !stripped.trim()) {
    return { ok: false, error: "JSONデータが空です" };
  }
  try {
    const parsed = JSON.parse(stripped) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "不正なJSON形式です" };
    }

    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) {
      return { ok: false, error: "指数の名称 (name) が必要です" };
    }

    const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
    const rawBaseValue = parsed.baseValue;
    const baseValue =
      typeof rawBaseValue === "number" && Number.isFinite(rawBaseValue) && rawBaseValue > 0
        ? rawBaseValue
        : 1000;

    const rawBasket = parsed.basket;
    if (!Array.isArray(rawBasket) || rawBasket.length === 0) {
      return { ok: false, error: "構成銘柄 (basket) は1銘柄以上必要です" };
    }

    const basket: BasketItem[] = [];
    const seenTickers = new Set<string>();

    for (const item of rawBasket) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const ticker = typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
      if (!ticker || seenTickers.has(ticker)) continue;
      seenTickers.add(ticker);

      const itemName = typeof r.name === "string" && r.name.trim() ? r.name.trim() : ticker;
      const theme = typeof r.theme === "string" && r.theme.trim() ? r.theme.trim() : "カスタム";
      const weight = typeof r.weight === "number" && Number.isFinite(r.weight) && r.weight > 0 ? r.weight : 1;

      basket.push({ ticker, name: itemName, theme, weight });
    }

    if (basket.length === 0) {
      return { ok: false, error: "有効な構成銘柄が見つかりませんでした" };
    }

    const id =
      typeof parsed.id === "string" && parsed.id.trim()
        ? parsed.id.trim()
        : `custom-${Date.now()}`;

    return {
      ok: true,
      data: {
        id,
        name,
        description,
        baseValue,
        basket,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `JSON解析エラー: ${err instanceof Error ? err.message : "構文が正しくありません"}`,
    };
  }
}

/**
 * 構成銘柄バスケットをCSV形式 (Ticker, Name, Theme, Weight) にシリアライズします。
 */
export function serializeBasketToCsv(basket: readonly BasketItem[]): string {
  const headers = ["コード", "銘柄名", "テーマ", "比率(%)"];
  const rows = basket.map((item) => [
    escapeCsvCell(item.ticker),
    escapeCsvCell(item.name),
    escapeCsvCell(item.theme),
    escapeCsvCell(item.weight),
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/**
 * CSV文字列から構成銘柄バスケットを読み込みパースします。
 */
export function deserializeBasketFromCsv(csvStr: string): SerializationResult<BasketItem[]> {
  const stripped = typeof csvStr === "string" ? csvStr.replace(/^\uFEFF/, "") : "";
  if (!stripped || !stripped.trim()) {
    return { ok: false, error: "CSVデータが空です" };
  }

  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { ok: false, error: "CSVにはヘッダー行と少なくとも1行の銘柄データが必要です" };
  }

  // 単純なCSVパーサー (カンマ分割および引用符対応)
  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields.map((f) => {
      let cleaned = f;
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).replace(/""/g, '"');
      }
      if (cleaned.startsWith("'")) {
        cleaned = cleaned.slice(1);
      }
      return cleaned.trim();
    });
  };

  const headerLine = parseLine(lines[0]);
  let tickerIdx = -1;
  let nameIdx = -1;
  let themeIdx = -1;
  let weightIdx = -1;

  for (let i = 0; i < headerLine.length; i++) {
    const h = headerLine[i].toLowerCase();
    if (h.includes("コード") || h.includes("ticker") || h.includes("code") || h.includes("symbol")) tickerIdx = i;
    else if (h.includes("名称") || h.includes("銘柄名") || h.includes("name")) nameIdx = i;
    else if (h.includes("テーマ") || h.includes("業種") || h.includes("theme") || h.includes("sector")) themeIdx = i;
    else if (h.includes("比率") || h.includes("ウェイト") || h.includes("weight") || h.includes("%")) weightIdx = i;
  }

  // ヘッダーが見つからない場合はデフォルトの列順 (0: ticker, 1: name, 2: theme, 3: weight)
  if (tickerIdx === -1) tickerIdx = 0;
  if (nameIdx === -1) nameIdx = 1;
  if (themeIdx === -1) themeIdx = 2;
  if (weightIdx === -1) weightIdx = 3;

  const basket: BasketItem[] = [];
  const seen = new Set<string>();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const fields = parseLine(lines[rowIdx]);
    if (fields.length <= tickerIdx) continue;
    const ticker = fields[tickerIdx]?.toUpperCase().trim();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);

    const name = (nameIdx < fields.length ? fields[nameIdx] : "") || ticker;
    const theme = (themeIdx < fields.length ? fields[themeIdx] : "") || "カスタム";
    const rawWeight = weightIdx < fields.length ? parseFloat(fields[weightIdx]) : NaN;
    const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;

    basket.push({ ticker, name, theme, weight });
  }

  if (basket.length === 0) {
    return { ok: false, error: "有効な銘柄行が見つかりませんでした" };
  }

  return { ok: true, data: basket };
}

/**
 * ポートフォリオ保有銘柄をCSV形式にシリアライズします。
 */
export function serializePortfolioToCsv(positions: readonly PortfolioPosition[]): string {
  const headers = ["コード", "銘柄名", "保有株数", "取得単価", "取得日", "メモ"];
  const rows = positions.map((p) => [
    escapeCsvCell(p.ticker),
    escapeCsvCell(p.name),
    escapeCsvCell(p.shares),
    escapeCsvCell(p.averageCost),
    escapeCsvCell(p.acquiredAt || ""),
    escapeCsvCell(p.notes || ""),
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/**
 * CSV文字列からポートフォリオ保有銘柄を読み込みパースします。
 */
export function deserializePortfolioFromCsv(
  csvStr: string,
): SerializationResult<PortfolioPosition[]> {
  const stripped = typeof csvStr === "string" ? csvStr.replace(/^\uFEFF/, "") : "";
  if (!stripped || !stripped.trim()) {
    return { ok: false, error: "CSVデータが空です" };
  }

  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return { ok: false, error: "CSVにはヘッダー行と少なくとも1行の保有データが必要です" };
  }

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields.map((f) => {
      let cleaned = f;
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).replace(/""/g, '"');
      }
      if (cleaned.startsWith("'")) {
        cleaned = cleaned.slice(1);
      }
      return cleaned.trim();
    });
  };

  const headerLine = parseLine(lines[0]);
  let tickerIdx = 0;
  let nameIdx = 1;
  let sharesIdx = 2;
  let costIdx = 3;
  let dateIdx = 4;
  let notesIdx = 5;

  for (let i = 0; i < headerLine.length; i++) {
    const h = headerLine[i].toLowerCase();
    if (h.includes("コード") || h.includes("ticker") || h.includes("symbol")) tickerIdx = i;
    else if (h.includes("銘柄名") || h.includes("名称") || h.includes("name")) nameIdx = i;
    else if (h.includes("株数") || h.includes("数量") || h.includes("shares") || h.includes("quantity")) sharesIdx = i;
    else if (h.includes("単価") || h.includes("コスト") || h.includes("cost") || h.includes("price")) costIdx = i;
    else if (h.includes("取得日") || h.includes("日付") || h.includes("date")) dateIdx = i;
    else if (h.includes("メモ") || h.includes("note")) notesIdx = i;
  }

  const positions: PortfolioPosition[] = [];

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const fields = parseLine(lines[rowIdx]);
    if (fields.length <= tickerIdx) continue;
    const ticker = fields[tickerIdx]?.toUpperCase().trim();
    if (!ticker) continue;

    const name = (nameIdx < fields.length ? fields[nameIdx] : "") || ticker;
    const rawShares = sharesIdx < fields.length ? parseFloat(fields[sharesIdx]) : NaN;
    const shares = Number.isFinite(rawShares) && rawShares > 0 ? rawShares : 100;

    const rawCost = costIdx < fields.length ? parseFloat(fields[costIdx]) : NaN;
    const averageCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 1000;

    const acquiredAt = dateIdx < fields.length ? fields[dateIdx] : undefined;
    const notes = notesIdx < fields.length ? fields[notesIdx] : undefined;

    positions.push({
      id: `pos-${ticker}-${Date.now()}-${rowIdx}`,
      ticker,
      name,
      shares,
      averageCost,
      acquiredAt: acquiredAt || undefined,
      notes: notes || undefined,
    });
  }

  if (positions.length === 0) {
    return { ok: false, error: "有効な保有銘柄行が見つかりませんでした" };
  }

  return { ok: true, data: positions };
}
