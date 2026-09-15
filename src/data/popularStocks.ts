export interface PopularStock {
  ticker: string;
  name: string;
  theme: string;
}

export const POPULAR_STOCKS: PopularStock[] = [
  // テック・半導体・電子
  { ticker: "8035", name: "東京エレクトロン", theme: "半導体製造装置" },
  { ticker: "6857", name: "アドバンテスト", theme: "半導体検査" },
  { ticker: "6920", name: "レーザーテック", theme: "最先端マスク検査" },
  { ticker: "6758", name: "ソニーグループ", theme: "エンタメ・電機" },
  { ticker: "6861", name: "キーエンス", theme: "FA・センサー" },
  { ticker: "6501", name: "日立製作所", theme: "社会インフラ・IT" },
  { ticker: "6702", name: "富士通", theme: "ITサービス・クラウド" },
  { ticker: "6723", name: "ルネサスエレクトロニクス", theme: "車載半導体" },
  { ticker: "6981", name: "村田製作所", theme: "電子部品・MLCC" },
  { ticker: "7735", name: "SCREENホールディングス", theme: "半導体洗浄" },
  { ticker: "6146", name: "ディスコ", theme: "半導体切断・研削" },

  // AI・通信・クラウド
  { ticker: "9984", name: "ソフトバンクグループ", theme: "AI・投資" },
  { ticker: "9432", name: "日本電信電話 (NTT)", theme: "通信・IOWN" },
  { ticker: "9433", name: "KDDI", theme: "通信・デジタル" },
  { ticker: "9434", name: "ソフトバンク", theme: "通信・PayPay" },
  { ticker: "3778", name: "さくらインターネット", theme: "クラウド・AI" },
  { ticker: "4689", name: "LINEヤフー", theme: "インターネット・広告" },

  // モビリティ・自動車
  { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ" },
  { ticker: "7267", name: "本田技研工業", theme: "自動車・2輪" },
  { ticker: "7269", name: "スズキ", theme: "軽自動車・インド市場" },
  { ticker: "7201", name: "日産自動車", theme: "自動車" },
  { ticker: "6902", name: "デンソー", theme: "自動車部品・CASE" },

  // 金融・メガバンク・保険
  { ticker: "8306", name: "三菱UFJ FG", theme: "メガバンク" },
  { ticker: "8316", name: "三井住友 FG", theme: "メガバンク" },
  { ticker: "8411", name: "みずほ FG", theme: "メガバンク" },
  { ticker: "8766", name: "東京海上ホールディングス", theme: "損害保険" },
  { ticker: "8604", name: "野村ホールディングス", theme: "証券・投資銀行" },

  // 総合商社
  { ticker: "8058", name: "三菱商事", theme: "総合商社" },
  { ticker: "8001", name: "伊藤忠商事", theme: "総合商社" },
  { ticker: "8031", name: "三井物産", theme: "総合商社" },
  { ticker: "8053", name: "住友商事", theme: "総合商社" },
  { ticker: "8002", name: "丸紅", theme: "総合商社" },

  // ゲーム・エンタメ・小売
  { ticker: "7974", name: "任天堂", theme: "ゲーム・IP" },
  { ticker: "9983", name: "ファーストリテイリング", theme: "グローバル小売" },
  { ticker: "3382", name: "セブン＆アイ・ホールディングス", theme: "コンビニ・流通" },
  { ticker: "7832", name: "バンダイナムコHD", theme: "玩具・IP" },
  { ticker: "9697", name: "カプコン", theme: "ゲーム開発" },
  { ticker: "4901", name: "富士フイルムHD", theme: "ヘルスケア・電子材料" },

  // 医薬・バイオ
  { ticker: "4502", name: "武田薬品工業", theme: "製薬" },
  { ticker: "4503", name: "アステラス製薬", theme: "製薬" },
  { ticker: "4568", name: "第一三共", theme: "抗体薬物複合体(ADC)" },
  { ticker: "4519", name: "中外製薬", theme: "抗体医薬" },

  // 素材・インフラ・重工
  { ticker: "5803", name: "フジクラ", theme: "光ファイバー・電力" },
  { ticker: "7011", name: "三菱重工業", theme: "防衛・エネルギー" },
  { ticker: "7012", name: "川崎重工業", theme: "防衛・航空宇宙" },
  { ticker: "7013", name: "IHI", theme: "防衛・航空機エンジン" },
  { ticker: "4063", name: "信越化学工業", theme: "シリコンウエハー・塩ビ" },
  { ticker: "5401", name: "日本製鉄", theme: "高機能鋼材" },

  // 米国主要インデックス銘柄
  { ticker: "AAPL", name: "Apple", theme: "コンシューマーテック" },
  { ticker: "MSFT", name: "Microsoft", theme: "クラウド・AI" },
  { ticker: "NVDA", name: "NVIDIA", theme: "AI半導体・GPU" },
  { ticker: "GOOGL", name: "Alphabet (Google)", theme: "検索・AI・クラウド" },
  { ticker: "AMZN", name: "Amazon", theme: "Eコマース・クラウド" },
  { ticker: "META", name: "Meta Platforms", theme: "SNS・メタバース・AI" },
  { ticker: "TSLA", name: "Tesla", theme: "EV・自動運転" },
];

export function searchPopularStocks(query: string, limit = 8): PopularStock[] {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  return POPULAR_STOCKS.filter(
    (s) =>
      s.ticker.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.theme.toLowerCase().includes(q)
  ).slice(0, limit);
}

/**
 * Curated subset of popular stocks shown as quick-add presets in modals/builders.
 * Centralised here so AddStockModal, IndexBuilderContent, and any future UIs
 * display the same list.
 */
export const PRESET_STOCKS: PopularStock[] = [
  { ticker: "7203", name: "トヨタ自動車", theme: "モビリティ" },
  { ticker: "9984", name: "ソフトバンクグループ", theme: "AI・投資" },
  { ticker: "8035", name: "東京エレクトロン", theme: "半導体製造装置" },
  { ticker: "6857", name: "アドバンテスト", theme: "半導体検査" },
  { ticker: "6758", name: "ソニーグループ", theme: "エンタメ・電機" },
  { ticker: "9983", name: "ファーストリテイリング", theme: "グローバル小売" },
  { ticker: "8306", name: "三菱UFJ FG", theme: "メガバンク" },
  { ticker: "8058", name: "三菱商事", theme: "総合商社" },
  { ticker: "7974", name: "任天堂", theme: "ゲーム・IP" },
  { ticker: "6861", name: "キーエンス", theme: "FA・センサー" },
  { ticker: "3778", name: "さくらインターネット", theme: "クラウド・AI" },
  { ticker: "6920", name: "レーザーテック", theme: "最先端マスク検査" },
  { ticker: "6501", name: "日立製作所", theme: "社会インフラ・IT" },
  { ticker: "5803", name: "フジクラ", theme: "光ファイバー・電力" },
];
