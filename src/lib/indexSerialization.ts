/**
 * Index & Portfolio Serialization & Diversification Analytics
 *
 * 独自指数のJSON/CSVエクスポート・インポート、ポートフォリオのCSV入出力、
 * およびHHI (ハーフィンダール・ハーシュマン指数) による分散度評価。
 */

import type { BasketItem } from "../types";
import type { CustomIndex } from "../data/indices";
import { createPortfolioPosition, type PortfolioPosition } from "./portfolioStorage";
import { escapeCsvCell, parseCsv } from "./csv";
import { normalizeTicker } from "./indexEngine";

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
 * Schema revision of the exported index JSON.
 *
 * The importer refuses a revision it does not understand instead of silently
 * mapping a foreign payload onto the current shape (which would clamp and
 * default the weights, silently re-weighting or dropping constituents).
 */
export const INDEX_EXPORT_VERSION = 1;

/**
 * 独自指数定義オブジェクトを整形されたJSON文字列にシリアライズします。
 */
export function serializeIndexToJson(index: CustomIndex): string {
  return JSON.stringify(
    {
      version: INDEX_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      id: index.id,
      name: index.name,
      description: index.description,
      baseValue: index.baseValue,
      // undefined の場合は JSON.stringify がキー自体を出力しない (従来フォーマット互換)。
      sortOrder: index.sortOrder,
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

    // A file written by another schema revision must not be silently mapped
    // onto the current shape. Files without a version predate the field and
    // are treated as version 1.
    const rawVersion = parsed.version;
    if (rawVersion !== undefined && rawVersion !== null) {
      if (
        typeof rawVersion !== "number" ||
        !Number.isSafeInteger(rawVersion) ||
        rawVersion < 1 ||
        rawVersion > INDEX_EXPORT_VERSION
      ) {
        return {
          ok: false,
          error: `対応していない指数JSONのバージョンです (version: ${String(rawVersion)})`,
        };
      }
    }

    const name = (typeof parsed.name === "string" ? parsed.name.trim() : "").slice(0, 100);
    if (!name) {
      return { ok: false, error: "指数の名称 (name) が必要です" };
    }

    const description = (typeof parsed.description === "string" ? parsed.description.trim() : "").slice(0, 500);
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
      // Worker 契約 (POST /api/calculate) に合わせて正規化する。全角ティッカーの
      // ままだとリクエスト全体が400になり、プレビューが黙ってデモ表示へ切り替わる。
      const ticker = normalizeTicker(typeof r.ticker === "string" ? r.ticker : "");
      if (
        !ticker ||
        ticker.length > 20 ||
        !/^[A-Za-z0-9.-]+$/.test(ticker) ||
        seenTickers.has(ticker)
      ) {
        continue;
      }
      seenTickers.add(ticker);

      const itemName = (
        typeof r.name === "string" && r.name.trim() ? r.name.trim() : ticker
      ).slice(0, 100);
      const theme = (
        typeof r.theme === "string" && r.theme.trim() ? r.theme.trim() : "カスタム"
      ).slice(0, 100);
      // 0 < weight <= 100 (100超は上限クランプ。0/NaN は従来どおり既定値)。
      const weight =
        typeof r.weight === "number" && Number.isFinite(r.weight) && r.weight > 0
          ? Math.min(r.weight, 100)
          : 1;

      basket.push({ ticker, name: itemName, theme, weight });
    }

    if (basket.length === 0) {
      return { ok: false, error: "有効な構成銘柄が見つかりませんでした" };
    }

    // Worker 契約 (POST /api/indices) は id に [A-Za-z0-9._-] と 100 字以内を要求する。
    // 不正な id のままだと保存が 400 で拒否されるため、生成済み id へ退避する。
    const rawId = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const id =
      rawId.length > 0 && rawId.length <= 100 && /^[A-Za-z0-9._-]+$/.test(rawId)
        ? rawId
        : `custom-${Date.now()}`;

    // sortOrder は任意項目。有限数値のときだけ復元し、Worker 契約
    // (0..9999 の整数、超過・負値は 400) に収まるよう補正する。補正しないと
    // 取り込み後に保存 (POST /api/indices) が 400 で失敗する。
    const rawSortOrder = parsed.sortOrder;
    const sortOrder =
      typeof rawSortOrder === "number" && Number.isFinite(rawSortOrder)
        ? Math.min(9999, Math.max(0, Math.floor(rawSortOrder)))
        : undefined;

    return {
      ok: true,
      data: {
        id,
        name,
        description,
        baseValue,
        basket,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
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
 * 数値文字列をパースします（全角数字、全角小数点、全角カンマ、負記号、通貨記号、3桁区切りカンマに対応）。
 */
export function parseNumericValue(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return NaN;
  const cleaned = val
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[－ー―\u2212\u2013\u2014]/g, "-")
    .replace(/[￥¥$＄€£￡%％\s]/g, "")
    .replace(/[,，、]/g, "")
    .trim();
  return parseFloat(cleaned);
}


/**
 * CSV文字列から構成銘柄バスケットを読み込みパースします。
 */
export function deserializeBasketFromCsv(csvStr: string): SerializationResult<BasketItem[]> {
  const rows = parseCsv(csvStr);
  if (rows.length === 0) {
    return { ok: false, error: "CSVデータが空です" };
  }
  if (rows.length < 2) {
    return { ok: false, error: "CSVにはヘッダー行と少なくとも1行の銘柄データが必要です" };
  }

  const headerLine = rows[0];
  let tickerIdx = -1;
  let nameIdx = -1;
  let themeIdx = -1;
  let weightIdx = -1;

  for (let i = 0; i < headerLine.length; i++) {
    const h = headerLine[i].toLowerCase();
    if (h.includes("コード") || h.includes("ticker") || h.includes("code") || h.includes("symbol")) tickerIdx = i;
    else if (h.includes("名称") || h.includes("銘柄名") || h.includes("name")) nameIdx = i;
    else if (h.includes("テーマ") || h.includes("業種") || h.includes("theme") || h.includes("sector")) themeIdx = i;
    else if (h.includes("比率") || h.includes("ウェイト") || h.includes("weight") ||
             h.includes("ウエイト") || h.includes("構成比") || h.includes("構成") ||
             h.includes("percent") || h.includes("allocation") || h.includes("share") ||
             h.includes("配分") || h.includes("%") || h.includes("％")) weightIdx = i;
  }

  const hasMatchedHeader =
    tickerIdx !== -1 || nameIdx !== -1 || themeIdx !== -1 || weightIdx !== -1;

  // ヘッダーが見つからない場合はデフォルトの列順 (0: ticker, 1: name, 2: theme, 3: weight)
  if (!hasMatchedHeader) {
    tickerIdx = 0;
    nameIdx = 1;
    themeIdx = 2;
    weightIdx = 3;
  } else {
    // ヘッダーが一部指定されている場合、未指定のtickerのみ0にフォールバック
    if (tickerIdx === -1) tickerIdx = 0;
  }

  const basket: BasketItem[] = [];
  const seen = new Set<string>();
  // 重みとして解析できた行数 (列欠落・値不正で全行が既定値 1 になった場合の検出用)。
  let validWeightCount = 0;

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const fields = rows[rowIdx];
    if (fields.length <= tickerIdx) continue;
    // Worker 契約に合わせて正規化 (全角→ASCII・大文字・文字種検証)。そのまま
    // 送ると1行の不正でリクエスト全体が400になり、保存もプレビューも止まる。
    const ticker = normalizeTicker(fields[tickerIdx] ?? "");
    if (!ticker || ticker.length > 20 || !/^[A-Za-z0-9.-]+$/.test(ticker) || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);

    const name = (
      (nameIdx !== -1 && nameIdx < fields.length ? fields[nameIdx] : "") || ticker
    ).slice(0, 100);
    const theme = (
      (themeIdx !== -1 && themeIdx < fields.length ? fields[themeIdx] : "") || "カスタム"
    ).slice(0, 100);
    const rawWeight = weightIdx !== -1 && weightIdx < fields.length ? parseNumericValue(fields[weightIdx]) : NaN;
    // 重みはパース忠実度を保つ (既存仕様: "1,000" → 1000)。Worker 契約 (>0 かつ <=100) は
    // リクエスト境界 (sanitizeBasketForRequest) で検証・補正する。
    const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
    if (Number.isFinite(rawWeight) && rawWeight > 0) validWeightCount += 1;

    basket.push({ ticker, name, theme, weight });
  }

  if (basket.length === 0) {
    return { ok: false, error: "有効な銘柄行が見つかりませんでした" };
  }

  // 重み列が解決できなかった場合、全銘柄が既定値 1 に丸められ意図しない配分で
  // 取り込まれる。既存の「列が無い場合は重み1」仕様は維持しつつ、呼び出し側が
  // 警告を表示できるよう ok:true + error で通知する。
  if (validWeightCount === 0) {
    return {
      ok: true,
      data: basket,
      error:
        "重み(比率)列を解決できなかったため、全銘柄の重みを1として取り込みました。ヘッダーに「比率(%)」「weight」「配分」等を含めるか、取り込み後に重みを編集してください",
    };
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
  const rows = parseCsv(csvStr);
  if (rows.length === 0) {
    return { ok: false, error: "CSVデータが空です" };
  }
  if (rows.length < 2) {
    return { ok: false, error: "CSVにはヘッダー行と少なくとも1行の保有データが必要です" };
  }

  const headerLine = rows[0];
  let tickerIdx = -1;
  let nameIdx = -1;
  let sharesIdx = -1;
  let costIdx = -1;
  let dateIdx = -1;
  let notesIdx = -1;

  for (let i = 0; i < headerLine.length; i++) {
    const h = headerLine[i].toLowerCase();
    if (h.includes("コード") || h.includes("ticker") || h.includes("code") || h.includes("symbol")) tickerIdx = i;
    else if (h.includes("銘柄名") || h.includes("名称") || h.includes("name")) nameIdx = i;
    else if (h.includes("株数") || h.includes("数量") || h.includes("shares") || h.includes("quantity")) sharesIdx = i;
    else if (h.includes("単価") || h.includes("コスト") || h.includes("cost") || h.includes("price")) costIdx = i;
    else if (h.includes("取得日") || h.includes("日付") || h.includes("date")) dateIdx = i;
    else if (h.includes("メモ") || h.includes("note")) notesIdx = i;
  }

  const hasMatchedHeader =
    tickerIdx !== -1 ||
    nameIdx !== -1 ||
    sharesIdx !== -1 ||
    costIdx !== -1 ||
    dateIdx !== -1 ||
    notesIdx !== -1;

  if (!hasMatchedHeader) {
    tickerIdx = 0;
    nameIdx = 1;
    sharesIdx = 2;
    costIdx = 3;
    dateIdx = 4;
    notesIdx = 5;
  } else {
    if (tickerIdx === -1) tickerIdx = 0;
  }

  const positions: PortfolioPosition[] = [];

  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const fields = rows[rowIdx];
    if (fields.length <= tickerIdx) continue;
    const ticker = normalizeTicker(fields[tickerIdx] ?? "");
    if (!ticker || ticker.length > 20 || !/^[A-Za-z0-9.-]+$/.test(ticker)) continue;

    const name = ((nameIdx !== -1 && nameIdx < fields.length ? fields[nameIdx] : "") || ticker).slice(0, 100);
    const rawShares = sharesIdx !== -1 && sharesIdx < fields.length ? parseNumericValue(fields[sharesIdx]) : NaN;
    const shares = Number.isFinite(rawShares) && rawShares > 0 ? rawShares : 100;

    const rawCost = costIdx !== -1 && costIdx < fields.length ? parseNumericValue(fields[costIdx]) : NaN;
    const averageCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 1000;

    const acquiredAt = dateIdx !== -1 && dateIdx < fields.length ? fields[dateIdx] : undefined;
    const notes = (notesIdx !== -1 && notesIdx < fields.length ? fields[notesIdx] : undefined)?.slice(0, 500);

    // UI-37: position identity has exactly one owner. Going through the factory
    // keeps imported rows and UI-added rows on the same id scheme; deriving an
    // id here (`pos-${ticker}-${Date.now()}-${rowIdx}`) produced duplicates for
    // two lots of the same ticker imported in the same millisecond, and the id
    // scheme had to be maintained in two places.
    positions.push(
      createPortfolioPosition({
        ticker,
        name,
        shares,
        averageCost,
        acquiredAt: acquiredAt || undefined,
        notes: notes || undefined,
      }),
    );
  }

  if (positions.length === 0) {
    return { ok: false, error: "有効な保有銘柄行が見つかりませんでした" };
  }

  return { ok: true, data: positions };
}
