/**
 * 市場区分・動的業種（セクター）・詳細産業（インダストリー）の統一フォーマッター
 *
 * ハードコードを排除し、外部API（Yahoo Finance assetProfile等）や
 * 銘柄ユニバースから動的に取得された生データを適切にローカライズ・フォーマットします。
 */

export function formatMarketLabel(market?: string | null): string {
  if (!market) return "東証";
  switch (market.toUpperCase()) {
    case "PRIME":
      return "東証プライム";
    case "STANDARD":
      return "東証スタンダード";
    case "GROWTH":
      return "東証グロース";
    case "ETF":
      return "東証ETF";
    case "REIT":
      return "東証REIT";
    case "PRO":
      return "TOKYO PRO Market";
    case "US":
      return "米国市場";
    case "INDEX":
      return "主要指数";
    case "FX":
      return "外国為替";
    case "COMMODITY":
      return "コモディティ";
    case "CRYPTO":
      return "暗号資産";
    default:
      return market;
  }
}

/**
 * GICS / Yahoo Finance 標準セクター名の日本語マッピング
 */
export const SECTOR_NAME_MAP: Record<string, string> = {
  "Technology": "テクノロジー",
  "Information Technology": "情報技術",
  "Financial Services": "金融サービス",
  "Financials": "金融",
  "Healthcare": "ヘルスケア・医療",
  "Consumer Cyclical": "一般消費財",
  "Consumer Discretionary": "一般消費財",
  "Consumer Defensive": "生活必需品",
  "Consumer Staples": "生活必需品",
  "Industrials": "資本財・産業",
  "Communication Services": "通信サービス",
  "Basic Materials": "素材・化学",
  "Materials": "素材",
  "Energy": "エネルギー",
  "Real Estate": "不動産",
  "Utilities": "公益・インフラ",
};

/**
 * 動的に取得されたセクター名を整形して返却。
 * 英語セクター名が存在する場合、対応する日本語訳を併記（例: "テクノロジー (Technology)"）。
 * 未知のセクター名であってもAPIから返却された生文字列を尊重してそのまま表示します。
 */
export function formatDynamicSector(sector?: string | null): string {
  if (!sector || !sector.trim()) return "その他";
  const trimmed = sector.trim();
  const ja = SECTOR_NAME_MAP[trimmed];
  if (ja) {
    return `${ja} (${trimmed})`;
  }
  return trimmed;
}

/**
 * 動的に取得された詳細産業（インダストリー）の簡易ローカライズ対応表（代表例）
 */
export const INDUSTRY_NAME_MAP: Record<string, string> = {
  "Semiconductors": "半導体",
  "Semiconductor Equipment & Materials": "半導体製造装置",
  "Software - Infrastructure": "インフラソフトウェア",
  "Software - Application": "アプリケーションソフト",
  "Consumer Electronics": "民生用エレクトロニクス",
  "Auto Manufacturers": "自動車メーカー",
  "Internet Retail": "インターネット小売り",
  "Internet Content & Information": "インターネット情報・コンテンツ",
  "Drug Manufacturers - General": "総合製薬",
  "Biotechnology": "バイオテクノロジー",
  "Banks - Diversified": "総合銀行",
  "Oil & Gas Integrated": "石油・天然ガス総合",
  "Aerospace & Defense": "航空・防衛",
};

/**
 * 動的に取得された産業名を整形して返却。
 */
export function formatDynamicIndustry(industry?: string | null): string {
  if (!industry || !industry.trim()) return "";
  const trimmed = industry.trim();
  const ja = INDUSTRY_NAME_MAP[trimmed];
  if (ja) {
    return `${ja} (${trimmed})`;
  }
  return trimmed;
}
