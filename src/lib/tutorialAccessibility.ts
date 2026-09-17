/**
 * Tutorial step definitions, accessibility announcements, and keyboard control mappings.
 */

export interface TutorialStep {
  id: number;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  keyAction: string;
  sceneDescription: string;
  ariaAnnouncement: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 1,
    badge: "Overview & Benchmark",
    title: "指数とベンチマークの比較分析",
    subtitle: "独自戦略と市場平均（日経225・S&P500）の客観的比較",
    description:
      "IndexForgeでは、保有・作成したカスタム指数と主要ベンチマークをリアルタイムに比較できます。基準日（Base Value=1000）で正規化されたパフォーマンスチャートにより、市場平均に対する超過リターン（アルファ）や騰落率を一目で分析できます。",
    keyAction: "上部ヘッダーのベンチマークセレクターや期間タブ（1M/3M/1Y/YTD）を切り替えて比較してみましょう。",
    sceneDescription:
      "3D空間に2つの光る球体クリスタル（カスタム指数と市場ベンチマーク）が浮かび、リターン差を繋ぐエネルギーパルスが脈動しています。",
    ariaAnnouncement:
      "ステップ1: 指数とベンチマークの比較分析。3D空間で自作指数と市場平均の相対リターンが対比表示されています。",
  },
  {
    id: 2,
    badge: "Constituents & Weighting",
    title: "構成銘柄とウェイト配分",
    subtitle: "時価総額加重・均等加重・独自配分の柔軟なカスタマイズ",
    description:
      "ポートフォリオを構成する銘柄ごとのウェイト（比率）を自由に設計できます。時価総額に応じた加重平均や、全銘柄を同一比率にする均等加重、保有株数に基づく配分など、投資哲学に合わせた精密な指数化が可能です。",
    keyAction: "ダッシュボードの構成銘柄一覧とセクター別ブレイクダウンで配分比率を確認・調整できます。",
    sceneDescription:
      "セクター比率を表す複数の立体シリンダーブロックが円環状（3Dドーナツ）に整列し、各資産クラスの比率を表現しています。",
    ariaAnnouncement:
      "ステップ2: 構成銘柄とウェイト配分。3D円環シリンダーが展開し、各銘柄・セクターの保有比率を可視化しています。",
  },
  {
    id: 3,
    badge: "Risk Analytics & Heatmap",
    title: "リスク指標とテーマヒートマップ",
    subtitle: "ボラティリティ・シャープレシオ・セクター相関の可視化",
    description:
      "単なる価格変動だけでなく、年率ボラティリティ、最大ドローダウン（下落率）、シャープレシオといった機関投資家水準のリスクリターン指標を自動算出。テーマ・セクターヒートマップでポートフォリオの偏りや相関性を瞬時に検知します。",
    keyAction: "チャート下部のリスク指標カードとテーマヒートマップで、リスクとリターンのバランスを精査しましょう。",
    sceneDescription:
      "ボラティリティとリターンを表す3Dリスクサーフェス地形メッシュと、セクターの強弱を示す光のグリッドが立体表示されています。",
    ariaAnnouncement:
      "ステップ3: リスク指標とテーマヒートマップ。3Dリスク地形グリッドが表示され、シャープレシオとドローダウンを立体的にハイライトしています。",
  },
  {
    id: 4,
    badge: "Index Builder & Simulation",
    title: "カスタム指数ビルダー＆シミュレーション",
    subtitle: "直感的な銘柄追加と過去データによるバックテスト",
    description:
      "ティッカーシンボルや銘柄名で素早く検索し、株数を指定して新しいカスタム指数を構築できます。過去データによる即時バックテストシミュレーションを実行し、あなたのアイデアが過去の市場環境でどのようなパフォーマンスを発揮したかを検証できます。",
    keyAction: "画面上部またはメニューの「指数ビルダー」ボタンから、いつでも新しい指数を作成・保存できます。",
    sceneDescription:
      "新しい指数ブロックが次々と組み上がり、金色のエネルギーキューブとして完成するビルドシミュレーション演出です。",
    ariaAnnouncement:
      "ステップ4: カスタム指数ビルダーとシミュレーション。3Dキューブブロックが構築され、カスタム指数の完成を象徴する光を放っています。",
  },
] as const;

export interface KeyboardShortcutHelp {
  key: string;
  label: string;
  category: "navigation" | "3d_camera" | "accessibility";
}

export const TUTORIAL_KEYBOARD_SHORTCUTS: readonly KeyboardShortcutHelp[] = [
  { key: "→ / Enter", label: "次のステップへ進む", category: "navigation" },
  { key: "←", label: "前のステップへ戻る", category: "navigation" },
  { key: "Esc", label: "チュートリアルを終了 / スキップ", category: "navigation" },
  { key: "↑ / W", label: "3Dカメラを上に仰角回転", category: "3d_camera" },
  { key: "↓ / S", label: "3Dカメラを下に俯角回転", category: "3d_camera" },
  { key: "← / A", label: "3Dカメラを左に回転", category: "3d_camera" },
  { key: "→ / D", label: "3Dカメラを右に回転", category: "3d_camera" },
  { key: "+ / =", label: "3Dカメラをズームイン", category: "3d_camera" },
  { key: "- / _", label: "3Dカメラをズームアウト", category: "3d_camera" },
  { key: "R", label: "3Dカメラの視点を初期位置にリセット", category: "3d_camera" },
  { key: "Space", label: "3D自動回転の一時停止 / 再開", category: "3d_camera" },
  { key: "M", label: "モーション軽減モードのON/OFF切り替え", category: "accessibility" },
] as const;

/**
 * Checks system-level prefers-reduced-motion setting.
 */
export function getSystemPrefersReducedMotion(): boolean {
  if (typeof globalThis === "undefined" || !("window" in globalThis)) {
    return false;
  }
  const win = (globalThis as unknown as { window?: { matchMedia?: (q: string) => { matches: boolean } } }).window;
  if (!win || typeof win.matchMedia !== "function") {
    return false;
  }
  return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Generates an announcement string for screen readers based on step and camera state.
 */
export function formatAccessibilityAnnouncement(
  step: TutorialStep,
  options?: { isReducedMotion?: boolean; isAutoRotatePaused?: boolean },
): string {
  const parts = [step.ariaAnnouncement];
  if (options?.isReducedMotion) {
    parts.push("（3Dアニメーションは軽減・静止モードです）");
  } else if (options?.isAutoRotatePaused) {
    parts.push("（3D自動回転は一時停止中です）");
  }
  return parts.join(" ");
}
