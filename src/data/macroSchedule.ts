/**
 * 金融政策決定会合・主要マクロ経済公定スケジュールマスター (2024 - 2027)
 *
 * 日銀金融政策決定会合 (BOJ) および 米連邦公開市場委員会 (FOMC) の
 * 公表済み公定日程、および最新の政策金利水準・予想中央値を一元管理します。
 */

export interface MeetingDateItem {
  year: number;
  month: number;
  day: number;
}

// 日銀金融政策決定会合 (BOJ) スケジュール公定マスター (2024 - 2027)
export const BOJ_MEETING_SCHEDULE: ReadonlyArray<MeetingDateItem> = [
  // 2024
  { year: 2024, month: 1, day: 23 },
  { year: 2024, month: 3, day: 19 },
  { year: 2024, month: 4, day: 26 },
  { year: 2024, month: 6, day: 14 },
  { year: 2024, month: 7, day: 31 },
  { year: 2024, month: 9, day: 20 },
  { year: 2024, month: 10, day: 31 },
  { year: 2024, month: 12, day: 19 },
  // 2025
  { year: 2025, month: 1, day: 24 },
  { year: 2025, month: 3, day: 19 },
  { year: 2025, month: 5, day: 1 },
  { year: 2025, month: 6, day: 13 },
  { year: 2025, month: 7, day: 31 },
  { year: 2025, month: 9, day: 19 },
  { year: 2025, month: 10, day: 30 },
  { year: 2025, month: 12, day: 19 },
  // 2026
  { year: 2026, month: 1, day: 23 },
  { year: 2026, month: 3, day: 19 },
  { year: 2026, month: 4, day: 28 },
  { year: 2026, month: 6, day: 16 },
  { year: 2026, month: 7, day: 31 },
  { year: 2026, month: 9, day: 18 },
  { year: 2026, month: 10, day: 30 },
  { year: 2026, month: 12, day: 18 },
  // 2027
  { year: 2027, month: 1, day: 22 },
  { year: 2027, month: 3, day: 19 },
  { year: 2027, month: 4, day: 28 },
  { year: 2027, month: 6, day: 16 },
  { year: 2027, month: 7, day: 30 },
  { year: 2027, month: 9, day: 22 },
  { year: 2027, month: 10, day: 29 },
  { year: 2027, month: 12, day: 17 },
];

// 米FOMC スケジュール公定マスター (2024 - 2027)
export const FOMC_MEETING_SCHEDULE: ReadonlyArray<MeetingDateItem> = [
  // 2024
  { year: 2024, month: 1, day: 31 },
  { year: 2024, month: 3, day: 20 },
  { year: 2024, month: 5, day: 1 },
  { year: 2024, month: 6, day: 12 },
  { year: 2024, month: 7, day: 31 },
  { year: 2024, month: 9, day: 18 },
  { year: 2024, month: 11, day: 7 },
  { year: 2024, month: 12, day: 18 },
  // 2025
  { year: 2025, month: 1, day: 29 },
  { year: 2025, month: 3, day: 19 },
  { year: 2025, month: 5, day: 7 },
  { year: 2025, month: 6, day: 18 },
  { year: 2025, month: 7, day: 30 },
  { year: 2025, month: 9, day: 17 },
  { year: 2025, month: 10, day: 29 },
  { year: 2025, month: 12, day: 10 },
  // 2026
  { year: 2026, month: 1, day: 28 },
  { year: 2026, month: 3, day: 18 },
  { year: 2026, month: 5, day: 6 },
  { year: 2026, month: 6, day: 17 },
  { year: 2026, month: 7, day: 29 },
  { year: 2026, month: 9, day: 16 },
  { year: 2026, month: 11, day: 4 },
  { year: 2026, month: 12, day: 16 },
  // 2027
  { year: 2027, month: 1, day: 27 },
  { year: 2027, month: 3, day: 17 },
  { year: 2027, month: 5, day: 5 },
  { year: 2027, month: 6, day: 16 },
  { year: 2027, month: 7, day: 28 },
  { year: 2027, month: 9, day: 22 },
  { year: 2027, month: 11, day: 3 },
  { year: 2027, month: 12, day: 15 },
];

/**
 * 基準日以降の直近予定会合日（N回分）を取得
 */
export function getNextScheduledMeetings(
  schedule: ReadonlyArray<MeetingDateItem>,
  refDate: Date = new Date(),
  count: number = 2,
): Date[] {
  const refTime = refDate.getTime() - 24 * 60 * 60 * 1000; // 過去24時間以内は当日分として含む
  const results: Date[] = [];
  for (const item of schedule) {
    const d = new Date(item.year, item.month - 1, item.day);
    if (d.getTime() >= refTime) {
      results.push(d);
      if (results.length >= count) break;
    }
  }
  return results;
}

/**
 * 最新のマクロ指標デフォルト値（前回実績・市場予想・解説）
 */
export const MACRO_METRICS_DEFAULTS = {
  boj: {
    previous: "0.25%",
    forecast: "0.50%",
    description: "日銀金融政策決定会合後の総裁定例記者会見。政策金利判断や国債買入れ方針に注目。",
  },
  fomc: {
    previous: "4.75%",
    forecast: "4.50%",
    description: "米連邦公開市場委員会（FOMC）政策金利発表および議長会見。FF金利誘導目標。",
  },
  jobs: {
    previous: "14.2万人",
    forecast: "15.0万人",
    description: "米労働省発表。非農業部門雇用者数変化、失業率、平均時給の伸び率。",
  },
  cpi: {
    previous: "2.7%",
    forecast: "2.6%",
    description: "米労働省発表。総合およびコア消費者物価指数のインフレ動向。",
  },
  jpCpi: {
    previous: "2.8%",
    forecast: "2.7%",
    description: "総務省発表。生鮮食品を除くコアCPI前年比。日銀利上げ判断の重要指標。",
  },
};
