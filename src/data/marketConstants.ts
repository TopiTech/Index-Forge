/**
 * 共通マーケット定数レイヤー
 *
 * Worker・ブラウザ双方で共有される市場ベースライン定数、業種定義、
 * 為替レート基準値、フォールバックニュース・データ出所定義。
 * コードベース全体に散在していたハードコード値を集約・一元管理します。
 */

export interface BaselineAssetQuote {
  symbol: string;
  querySymbol: string;
  name: string;
  category: "INDEX" | "FX" | "COMMODITY" | "CRYPTO" | "BOND";
  currency: string;
  baselinePrice: number;
  baselineChange: number;
  baselineChangePercent: number;
}

/**
 * グローバル市場主要資産のベースライン定数定義。
 * 外部API (Yahoo Finance等) が一切利用できないオフライン環境や
 * コールドスタート時における信頼できる基準値を提供します。
 */
export const BASELINE_ASSET_QUOTES: readonly BaselineAssetQuote[] = [
  {
    symbol: "^N225",
    querySymbol: "^N225",
    name: "日経平均株価",
    category: "INDEX",
    currency: "JPY",
    baselinePrice: 39500.0,
    baselineChange: 120.0,
    baselineChangePercent: 0.3,
  },
  {
    symbol: "^TOPX",
    querySymbol: "1308.T",
    name: "TOPIX (東証株価指数)",
    category: "INDEX",
    currency: "JPY",
    baselinePrice: 2720.0,
    baselineChange: 15.0,
    baselineChangePercent: 0.55,
  },
  {
    symbol: "^TOPIXG",
    querySymbol: "2516.T",
    name: "東証グロース250",
    category: "INDEX",
    currency: "JPY",
    baselinePrice: 640.0,
    baselineChange: 5.5,
    baselineChangePercent: 0.87,
  },
  {
    symbol: "^GSPC",
    querySymbol: "^GSPC",
    name: "S&P 500",
    category: "INDEX",
    currency: "USD",
    baselinePrice: 5850.0,
    baselineChange: 25.0,
    baselineChangePercent: 0.43,
  },
  {
    symbol: "^IXIC",
    querySymbol: "^IXIC",
    name: "NASDAQ 総合",
    category: "INDEX",
    currency: "USD",
    baselinePrice: 18500.0,
    baselineChange: 110.0,
    baselineChangePercent: 0.6,
  },
  {
    symbol: "^DJI",
    querySymbol: "^DJI",
    name: "NYダウ平均",
    category: "INDEX",
    currency: "USD",
    baselinePrice: 43500.0,
    baselineChange: 180.0,
    baselineChangePercent: 0.42,
  },
  {
    symbol: "USDJPY=X",
    querySymbol: "USDJPY=X",
    name: "米ドル / 円",
    category: "FX",
    currency: "JPY",
    baselinePrice: 155.0,
    baselineChange: 0.2,
    baselineChangePercent: 0.13,
  },
  {
    symbol: "EURJPY=X",
    querySymbol: "EURJPY=X",
    name: "ユーロ / 円",
    category: "FX",
    currency: "JPY",
    baselinePrice: 165.0,
    baselineChange: 0.15,
    baselineChangePercent: 0.09,
  },
  {
    symbol: "EURUSD=X",
    querySymbol: "EURUSD=X",
    name: "ユーロ / ドル",
    category: "FX",
    currency: "USD",
    baselinePrice: 1.065,
    baselineChange: -0.001,
    baselineChangePercent: -0.09,
  },
  {
    symbol: "CL=F",
    querySymbol: "CL=F",
    name: "WTI 原油先物",
    category: "COMMODITY",
    currency: "USD",
    baselinePrice: 72.5,
    baselineChange: 0.45,
    baselineChangePercent: 0.62,
  },
  {
    symbol: "GC=F",
    querySymbol: "GC=F",
    name: "金先物 (Gold)",
    category: "COMMODITY",
    currency: "USD",
    baselinePrice: 2750.0,
    baselineChange: 12.0,
    baselineChangePercent: 0.44,
  },
  {
    symbol: "^TNX",
    querySymbol: "^TNX",
    name: "米国10年債利回り",
    category: "BOND",
    currency: "%",
    baselinePrice: 4.45,
    baselineChange: 0.02,
    baselineChangePercent: 0.45,
  },
  {
    symbol: "BTC-USD",
    querySymbol: "BTC-USD",
    name: "ビットコイン (BTC)",
    category: "CRYPTO",
    currency: "USD",
    baselinePrice: 92000.0,
    baselineChange: 1500.0,
    baselineChangePercent: 1.66,
  },
  {
    symbol: "ETH-USD",
    querySymbol: "ETH-USD",
    name: "イーサリアム (ETH)",
    category: "CRYPTO",
    currency: "USD",
    baselinePrice: 3400.0,
    baselineChange: 55.0,
    baselineChangePercent: 1.64,
  },
] as const;

/** デフォルトのUSD/JPY基準為替レート */
export const DEFAULT_USD_JPY_RATE = 155.0;

/** 東証33業種を代表する10主要セクター分類とサンプリング用代表銘柄 */
export interface SectorDefinition {
  name: string;
  market: "TSE" | "US";
  tickers: string[];
}

export const DEFAULT_SECTOR_DEFINITIONS: readonly SectorDefinition[] = [
  { name: "電気機器・半導体", market: "TSE", tickers: ["8035.T", "6857.T", "6758.T", "6861.T"] },
  { name: "精密機器", market: "TSE", tickers: ["7735.T", "6146.T"] },
  { name: "輸送用機器", market: "TSE", tickers: ["7203.T", "7267.T", "6902.T"] },
  { name: "銀行業", market: "TSE", tickers: ["8306.T", "8316.T", "8411.T"] },
  { name: "卸売業 (商社)", market: "TSE", tickers: ["8058.T", "8001.T", "8031.T"] },
  { name: "情報・通信業", market: "TSE", tickers: ["9984.T", "9432.T", "9433.T"] },
  { name: "医薬品", market: "TSE", tickers: ["4502.T", "4503.T", "4519.T"] },
  { name: "化学・素材", market: "TSE", tickers: ["4063.T", "4188.T", "5401.T"] },
  { name: "食料品・小売", market: "TSE", tickers: ["2914.T", "9983.T", "3382.T"] },
  { name: "鉱業・エネルギー", market: "TSE", tickers: ["1605.T", "5020.T"] },
] as const;

/** フォールバック用の高品質市場ニューステンプレート */
export interface FallbackNewsItem {
  id: string;
  title: string;
  source: string;
  relatedTicker?: string;
}

export const FALLBACK_MARKET_NEWS_TEMPLATES: readonly FallbackNewsItem[] = [
  {
    id: "news-baseline-1",
    title: "日経平均は高水準推移、主要ハイテク・半導体関連株に実需買い",
    source: "市場速報",
    relatedTicker: "8035",
  },
  {
    id: "news-baseline-2",
    title: "米ドル円は155円台で推移、日米金利動向と実需フローを見極め",
    source: "為替市況",
    relatedTicker: "USDJPY=X",
  },
  {
    id: "news-baseline-3",
    title: "米ハイテク株と主要指数が堅調推移、インフラ・生成AI需要が下支え",
    source: "グローバル金融",
    relatedTicker: "NVDA",
  },
  {
    id: "news-baseline-4",
    title: "東証プライム騰落レシオは良好、好業績バリュー銘柄に見直し買いが継続",
    source: "株式ニュース",
  },
] as const;
