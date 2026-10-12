# フェーズ1 — ベースライン確認と包括的コードレビュー結果 / フェーズ2修正計画

> 生成: 2026-10-11 (architect モード / comprehensive-code-review スキル準拠)
> ステータス: レビュー完了・修正計画承認待ち → フェーズ2 (code モード) へ委譲

---

## 1. ベースライン確認結果

### 1.1 ドキュメント確認 (完了)
- [`package.json`](package.json) — 検証コマンド: `npm run build` (tsc x2 + vite build) / `npm run lint` / `npm test` (vitest run)
- [`README.md`](README.md) / [`dev-commands.md`](dev-commands.md) — 開発・検証手順を確認
- [`goal.json`](.agent/goal.json) — 前回ラウンド (goal-20260918-review) は完了: **65 テストファイル / 609 テスト成功, ESLint 0 エラー, ビルド成功**

### 1.2 ベースライン実行
- **ユーザー承認により省略** — 「ベースライン実行は省略し、静的コードレビューのみ進める(実行はフェーズ2のcodeモードに委譲)」
- フェーズ2の最初のアクションとして `npm test` / `npm run lint` / `npm run build` を実行し、結果を記録すること

---

## 2. レビュー結果 (優先度順)

### 良好な点 (確認済み・維持すること)
| 項目 | 根拠 |
|---|---|
| PBKDF2-SHA256 100k 反復 + timing-safe 比較 | [`worker/internal-impl.ts`](worker/internal-impl.ts) |
| owner token は SHA-256 ハッシュ化保存・URL に載せない (ヘッダのみ) | [`useIndices.ts`](src/hooks/useIndices.ts), [`schema.sql`](schema.sql) |
| D1 アトミック UPSERT レート制限 + クォータ競合 INSERT ガード | [`worker/internal-impl.ts`](worker/internal-impl.ts) |
| CSP / HSTS / X-Frame-Options / Permissions-Policy ヘッダ | [`worker/internal-impl.ts`](worker/internal-impl.ts) |
| CSV インジェクション対策 | [`csv.ts`](src/lib/csv.ts) `escapeCsvCell` |
| ETag / 304 条件付きリクエスト | [`useIndices.ts`](src/hooks/useIndices.ts) |
| モーダルフォーカストラップ | [`useModalFocus.ts`](src/hooks/useModalFocus.ts) |
| スキーマ移行フォールバックの堅牢なガード | [`worker/internal-impl.ts`](worker/internal-impl.ts) `isMissingColumnError` |

### P1 (高) — データ真正性
| # | 問題 | 根拠 | 影響 |
|---|---|---|---|
| P1-1 | 未知ティッカーのファンダメンタルを**擬似乱数で生成**し実データのように表示 (PER/PBR/配当利回り等)。デモフラグが UI まで伝播しているか不透明 | [`marketDataService.ts`](src/lib/marketDataService.ts) `getStockFundamentals` → [`StockDetailPage.tsx`](src/components/StockDetailPage.tsx) | 投資判断の誤導リスク |
| P1-2 | カレンダーの Yahoo 取得失敗時に**静的生成イベント**をフォールバック返却。実在しない決算日程等が表示され得る | [`worker/internal-impl.ts`](worker/internal-impl.ts) `fetchLiveMarketCalendar` → [`CalendarPage.tsx`](src/components/CalendarPage.tsx) | ユーザー向けデータ正確性 |

### P2 (中) — セキュリティ / 堅牢性
| # | 問題 | 根拠 | 影響 |
|---|---|---|---|
| P2-1 | `getClientIp` が `x-real-ip` / `x-forwarded-for` を信頼。直接アクセスするクライアントがスプーフィングでレート制限回避可能 | [`worker/internal-impl.ts`](worker/internal-impl.ts) `getClientIp` | レート制限バイパス |
| P2-2 | `findPasswordCollision` が O(n) 回の PBKDF2 (100k 反復) 検証。ユーザー数増加で Workers CPU 制限到達リスク | [`worker/internal-impl.ts`](worker/internal-impl.ts) | 管理操作のタイムアウト |
| P2-3 | ニュース/セクターの静的フォールバック (`DEFAULT_MARKET_OVERVIEW`) の鮮度表示が不十分 | [`marketDataService.ts`](src/lib/marketDataService.ts) → [`MarketOverviewPage.tsx`](src/components/MarketOverviewPage.tsx) | 古い情報の継続表示 |

### P3 (低) — 記録のみ (フェーズ2スコープ外、対応可否は判断)
- レガシー unsalted SHA-256 パスワードハッシュ経路が現役 (ログイン時に移行)。移行完了率の可視化が望ましい — [`worker/internal-impl.ts`](worker/internal-impl.ts)
- per-isolate インメモリキャッシュ/レート制限の分断 (アーキテクチャ上の既知制約。ドキュメント化で対応)
- [`useCalculation.ts`](src/hooks/useCalculation.ts) クライアント計算キャッシュ 50 エントリの削除順序 (LRU か挿入順か) の確認

---

## 3. フェーズ2修正計画 (code モード向け実行指示)

### マイルストーン0: ベースライン実行と goal.json 適用
1. `npm test` / `npm run lint` / `npm run build` を実行し結果を記録
2. 本ファイル §5 の JSON を [`goal.json`](.agent/goal.json) に適用 (architect モードは .md のみ編集可のため委譲)

### マイルストーン1: データ真正性の明示 (P1)
- **M1-1**: [`getStockFundamentals`](src/lib/marketDataService.ts) の生成データに `isDemoData: true` を付与し、[`StockDetailPage.tsx`](src/components/StockDetailPage.tsx) に「参考値 (デモ)」バッジを表示
- **M1-2**: [`fetchLiveMarketCalendar`](worker/internal-impl.ts) のフォールバック応答に `source: "fallback"` メタデータを付与し、[`CalendarPage.tsx`](src/components/CalendarPage.tsx) でフォールバック表示
- **M1-3**: 回帰テスト追加 ([`marketDataService.test.ts`](src/lib/marketDataService.test.ts) 拡張)
- 期待結果: 生成データが実データと区別して表示される
- 検証: `npm test` + 新規テスト

### マイルストーン2: セキュリティ堅牢化 (P2)
- **M2-1**: [`getClientIp`](worker/internal-impl.ts) を `CF-Connecting-IP` 最優先に変更 (`x-forwarded-for` は左端でなく信頼済みプロキシチェーン解釈)
- **M2-2**: [`findPasswordCollision`](worker/internal-impl.ts) に検証件数上限 or 早期リターン順序最適化を導入
- **M2-3**: 回帰テスト ([`securityAndAdmin.test.ts`](src/lib/securityAndAdmin.test.ts) 拡張)
- 期待結果: ヘッダスプーフィングによるレート制限回避の低減、管理操作の CPU 負荷低減
- 検証: `npm test` + 新規テスト

### マイルストーン3: 全検証と報告
- `npm test` / `npm run lint` / `npm run build` を再実行し全成功を確認
- [`goal.json`](.agent/goal.json) の progress/evidence を最終更新 (status: completed)

### 制約 (フェーズ2でも維持)
- 公開 API・データ形式変更時は互換性維持または移行措置
- 無関係なリファクタリング禁止
- 本番デプロイ・破壊的コマンド禁止

---

## 4. 未解決事項
1. ベースライン実行結果 (テスト/リント/ビルド) — フェーズ2で取得
2. P3 項目の対応要否 — オーケストレーター判断待ち
3. `src/lib/workerApi.ts` は実在せず (`workerApi.test.ts` のみ) — テスト対象モジュールの所在要確認

---

## 5. goal.json 更新ペイロード (フェーズ2が適用)

```json
{
  "version": 1,
  "id": "goal-20261011-phase1-review",
  "status": "active",
  "objective": "フェーズ1包括コードレビューの結果に基づき、データ真正性 (擬似生成ファンダメンタル/カレンダーフォールバックの明示) とセキュリティ堅牢化 (getClientIp 信頼順序、findPasswordCollision CPU コスト) を修正し、既定の全検証を通す",
  "completion_criteria": [
    "ベースライン検証 (npm test / npm run lint / npm run build) の実行と記録",
    "P1: getStockFundamentals のデモフラグ伝播と StockDetailPage 表示",
    "P1: fetchLiveMarketCalendar フォールバックのメタデータ付与と CalendarPage 表示",
    "P2: getClientIp を CF-Connecting-IP 最優先に変更",
    "P2: findPasswordCollision の CPU 負荷対策",
    "回帰テスト追加と全検証成功",
    "最終報告に調査範囲・問題・変更理由・互換性影響・未解決事項が含まれる"
  ],
  "constraints": [
    "公開API・データ形式を変更する場合は互換性維持または移行措置を講じる",
    "既存のユーザー変更を壊さない",
    "無関係なリファクタリングを行わない",
    "本番デプロイ・破壊的コマンドは実行しない"
  ],
  "non_goals": [
    "大規模な設計変更",
    "依存ライブラリのメジャーアップグレード",
    "P3 項目の網羅対応 (別途判断)"
  ],
  "verification": [
    "npm run build (tsc --noEmit x2 + vite build)",
    "npm run lint",
    "npm test (vitest)"
  ],
  "budget": {
    "max_iterations": 20,
    "max_elapsed_minutes": null
  },
  "progress": {
    "iteration": 3,
    "completed": [
      "ベースラインドキュメント確認 (package.json / README / dev-commands / 前回 goal)",
      "ベースライン実行はフェーズ2委譲をユーザー承認",
      "全コードレビュー完了 (worker/internal-impl.ts 5543行含む worker, src/lib, src/hooks, src/components, schema.sql)"
    ],
    "remaining": [
      "マイルストーン0: ベースライン実行と goal.json 適用",
      "マイルストーン1: データ真正性の明示 (P1)",
      "マイルストーン2: セキュリティ堅牢化 (P2)",
      "マイルストーン3: 全検証と最終報告"
    ],
    "last_action": "phase1_static_review",
    "last_result": "静的レビュー完了: P1x2, P2x3, P3x3 を検出。修正計画は plans/phase1-review-and-fix-plan.md を参照"
  },
  "evidence": [
    "前回ラウンド: vitest 65 passed (609 tests), eslint 0 errors, tsc + vite build success",
    "静的レビュー: worker/internal-impl.ts, src/lib (indexEngine, marketDataService, marketCache, auth, csv, weights, treemap, analytics, navigation), src/hooks (useSimulation, useCalculation, useIndices, useBenchmark, useModalFocus), src/components 主要全ファイル, schema.sql",
    "検出問題: P1x2 (擬似生成ファンダメンタル, カレンダー静的フォールバック), P2x3 (getClientIp ヘッダ信頼, findPasswordCollision CPU, ニュース鮮度), P3x3"
  ],
  "blockers": [],
  "created_at": "2026-10-11T23:30:00Z",
  "updated_at": "2026-10-11T23:30:00Z"
}
```
