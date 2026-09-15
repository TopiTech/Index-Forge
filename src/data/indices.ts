import type { BasketItem } from "../types";

export interface CustomIndex {
  id: string;
  name: string;
  description: string;
  baseValue: number;
  basket: BasketItem[];
  sortOrder?: number;
}

// Built-in system index IDs that cannot be deleted or assigned user ownership
export const SYSTEM_INDICES = new Set([
  "nikkei-175",
  "eroge-index",
  "ai-semi",
  "infra-tech",
  "jp-core",
]);
export const SYSTEM_INDEX_IDS = SYSTEM_INDICES;

export const DEFAULT_INDICES: CustomIndex[] = [
  {
    id: "ai-semi",
    name: "AI・半導体強化指数",
    description: "最先端のAI技術と半導体製造装置メーカーを中心に構成された指数です。",
    baseValue: 1000,
    basket: [
      { ticker: "9984", name: "ソフトバンクグループ", weight: 15, theme: "AI投資" },
      { ticker: "8035", name: "東京エレクトロン", weight: 15, theme: "製造装置" },
      { ticker: "6857", name: "アドバンテスト", weight: 10, theme: "検査装置" },
      { ticker: "6920", name: "レーザーテック", weight: 10, theme: "検査装置" },
      { ticker: "6146", name: "ディスコ", weight: 10, theme: "加工装置" },
      { ticker: "7735", name: "SCREEN", weight: 10, theme: "洗浄装置" },
      { ticker: "6723", name: "ルネサス", weight: 10, theme: "車載半導体" },
      { ticker: "3778", name: "さくらインターネット", weight: 10, theme: "AIクラウド" },
      { ticker: "3993", name: "PKSHA", weight: 5, theme: "AIソフト" },
      { ticker: "4180", name: "Appier", weight: 5, theme: "AIソフト" },
    ],
  },
  {
    id: "infra-tech",
    name: "次世代インフラ・通信指数",
    description: "日本の通信インフラとDXを支える大手企業で構成される安定成長指数です。",
    baseValue: 1000,
    basket: [
      { ticker: "9432", name: "NTT", weight: 15, theme: "通信・IOWN" },
      { ticker: "9433", name: "KDDI", weight: 15, theme: "通信" },
      { ticker: "9434", name: "ソフトバンク", weight: 15, theme: "通信" },
      { ticker: "6501", name: "日立製作所", weight: 15, theme: "DXインフラ" },
      { ticker: "6702", name: "富士通", weight: 10, theme: "DXサービス" },
      { ticker: "6701", name: "NEC", weight: 10, theme: "通信設備" },
      { ticker: "5803", name: "フジクラ", weight: 10, theme: "光ファイバー" },
    ],
  },
  {
    id: "jp-core",
    name: "日本コア・企業指数",
    description: "日本を代表する時価総額上位の優良株をバランスよく配置した指数です。",
    baseValue: 1000,
    basket: [
      { ticker: "7203", name: "トヨタ自動車", weight: 15, theme: "自動車" },
      { ticker: "4063", name: "信越化学工業", weight: 10, theme: "素材" },
      { ticker: "9983", name: "ファーストリテイリング", weight: 10, theme: "小売" },
      { ticker: "8306", name: "三菱UFJ FG", weight: 10, theme: "金融" },
      { ticker: "6758", name: "ソニーグループ", weight: 10, theme: "電機" },
      { ticker: "8058", name: "三菱商事", weight: 10, theme: "商社" },
      { ticker: "6861", name: "キーエンス", weight: 10, theme: "自動化" },
      { ticker: "7974", name: "任天堂", weight: 10, theme: "娯楽" },
    ],
  },
  {
    id: "eroge-index",
    name: "完全エロゲ指数（EROGE Index）",
    description: "国内エロゲ・同人DL市場への直接・間接エクスポージャーを重視した構成です。",
    baseValue: 1000,
    basket: [
      { ticker: "2681", name: "ゲオホールディングス", weight: 35, theme: "DLSite" },
      { ticker: "7803", name: "ブシロード", weight: 20, theme: "萌えゲーム" },
      { ticker: "3657", name: "ポールトゥウィンHD", weight: 15, theme: "開発支援" },
      { ticker: "3791", name: "IGポート", weight: 10, theme: "アニメIP" },
      { ticker: "2652", name: "まんだらけ", weight: 8, theme: "同人市場" },
      { ticker: "9468", name: "KADOKAWA", weight: 4, theme: "ゲーム/アニメ" },
      { ticker: "4751", name: "サイバーエージェント", weight: 8, theme: "ゲーム/アニメ" },
    ],
  },
  {
    id: "nikkei-175",
    name: "日経175指数",
    description: "掲示板センチメント、モメンタム、国策テーマ、技術投機など175銘柄で構成される独自指数です。",
    baseValue: 1000,
    basket: [
      { ticker: "7203", name: "トヨタ自動車", weight: 20, theme: "自動車" },
      { ticker: "9984", name: "ソフトバンクグループ", weight: 20, theme: "AI投資" },
      { ticker: "8035", name: "東京エレクトロン", weight: 20, theme: "製造装置" },
      { ticker: "6758", name: "ソニーグループ", weight: 20, theme: "エンタメ" },
      { ticker: "9983", name: "ファーストリテイリング", weight: 20, theme: "小売" },
    ],
  },
];
