# 包括的コードレビュー — 課題インベントリ / 修正契約（2026-10-25）

> 本ファイルは修正パスの契約である。初版は production code を変更せずに作成し、2026-10-25 の Unit A / Unit C (S2) パスで S1・S2・S9 を、Unit B パスで S3・S4 を、Unit C (S5) パスで S5 を、Unit D パスで D1 を修正した。最終パスで S5 の body 読み取り期限を補完した。
> 記載の重大度は本プロジェクトの運用表記（High / Medium / Low）。根拠はすべて実コードの行番号で示す。
> 誤検知・意図された仕様・テストで固定済みの挙動は §5 で明示的に除外した。

---

## 0. ベースライン（本ファイル作成時に実測）

環境: Windows / Node（`package.json` の scripts をそのまま使用）/ `main` ブランチ / 作業ツリー clean（`git status --short` 空）。

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint`（`eslint . --max-warnings=0`） | **0** | PASS（警告 0） |
| test | `npm test`（`vitest run`, vmThreads） | **0** | PASS — **241 files / 2,329 tests**（8.17s） |
| typecheck (app) | `tsc -p tsconfig.app.json --noEmit`（`npm run build` 内） | **0** | PASS |
| typecheck (worker) | `tsc -p tsconfig.worker.json --noEmit`（`npm run build` 内） | **0** | PASS |
| typecheck (test) | `tsc -p tsconfig.test.json --noEmit`（`npm run build` 内） | **0** | PASS |
| build | `npm run build`（上記 3 tsc + `vite build`） | **0** | PASS（vite 3.99s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 782,676 B raw / 219,807 B gzip（予算 900,000 / 250,000） |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 910.93 KiB raw / 148.06 KiB gzip、D1/ASSETS バインド解決 |

### 0.5 Unit D（スキーマ単一ソース）後の再検証（2026-10-25）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test | `npm test` | **0** | PASS — **250 files / 2,359 tests**（8.99s。新規 `schemaSingleSource.test.ts` 7 件と `schemaContract.test.ts` の収束テスト 1 件を含む） |
| typecheck app / worker / test | `npx tsc -p tsconfig.{app,worker,test}.json --noEmit` | **0 / 0 / 0** | PASS |
| build | `npm run build` | **0** | PASS（3 × tsc + vite 4.09s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 782,654 B raw / 219,906 B gzip |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 910.03 KiB raw / 147.69 KiB gzip |
| 生成の冪等性 | `node scripts/generate-schema-steps.mjs` × 2 | **0** | 2 回目は差分なし |
| ドリフト検出（正典側） | `schema.sql` に `drift_probe` 列を一時追加 → `npx vitest run src/lib/schemaSingleSource.test.ts` | **1** | `column access_passwords.drift_probe missing from the artifact` で fail（復元後 PASS） |
| ドリフト検出（生成物側） | 生成ステップに `ghost_artifact` を一時追加 → 同テスト | **1** | `table ghost_artifact is not defined in schema.sql` で fail（復元後 PASS） |
| レガシー DB の収束 | `npx vitest run src/lib/schemaContract.test.ts` | **0** | 10 tests。旧 indices / basket_items / access_passwords に生成 migration を適用し、全テーブルの列集合と索引集合が schema.sql と一致 |

補足: `schema.sql` の差分はコメント（ヘッダと `-- @legacy-add` 7 箇所）のみで、テーブル・列・索引・既定値・制約は変更していない（`git diff schema.sql` で確認）。

### 0.7 包括的品質監査・根本原因解決（2026-10-25、S10–S14）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint`（`eslint . --max-warnings=0`） | **0** | PASS（警告 0） |
| test | `npm test`（`vitest run`） | **0** | PASS — **251 files / 2,376 tests**（9.22s） |
| typecheck app / worker / test | `npx tsc -p tsconfig.{app,worker,test}.json --noEmit` | **0 / 0 / 0** | PASS |
| build | `npm run build`（3 × tsc + `vite build`） | **0** | PASS（vite 4.11s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 784,157 B raw / 220,480 B gzip（予算 900,000 / 250,000） |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 910.03 KiB raw / 147.69 KiB gzip |

補足:
- S10: `calculatePortfolioSummary` の options オブジェクト化（互換性完全維持）。
- S11: `PortfolioManagerPage` の `totalMarketValue <= 0` 時のゼロ除算・NaN% 表示防止。
- S12: `analytics.ts` の `roundSafe` 単一ソース化および `calculateStockDetails` の NaN/-0 伝播防止。
- S13: `apply-migrations.mjs` の `owner_token_issued_at` 存在前提チェックの追加。
- S14: `useBenchmark` (304), `EditPasswordModal` (ok), `AdminDashboard` (ok) での `releaseResponse` 呼び出しによるリソース・タイマー漏れの完全解消。

### 0.6 リクエスト期限の body 全体化（2026-10-25、最終変更）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test | `npm test` | **0** | PASS — **250 files / 2,364 tests**（8.82s。`apiContract.test.ts` は 49 → 54 件） |
| typecheck app / worker / test | `npx tsc -p tsconfig.{app,worker,test}.json --noEmit` | **0 / 0 / 0** | PASS |
| build | `npm run build` | **0** | PASS（3 × tsc + vite 4.02s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 784,024 B raw / 220,398 B gzip（予算 900,000 / 250,000） |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 910.03 KiB raw / 147.69 KiB gzip |
| stalled body | `npx vitest run src/lib/apiContract.test.ts` | **0** | 54 tests。ヘッダ即時・body 永不完了でも 20ms で `FetchTimeoutError`。正常読了・非 JSON body 後の timer 0 と listener 解除、caller abort 中の stalled body 解放（timer 0）、未読破棄時の timer 0 を固定 |
| S5 回帰 | `npx vitest run src/hooks/useIndices.networkFallback.test.tsx src/components/stockTechnicalChartRequestLifecycle.test.tsx src/hooks/useSimulation.loadingOwnership.test.tsx` | **0** | 12 tests。既存の abort/timeout UI を維持 |

補足: 期限と caller listener は返却 Response の `json` / `text` / `arrayBuffer` / `blob` / `formData` が settle するまで保持し、body を読まない応答は `releaseResponse` で即時解放する。初回ペイントは +1,370 B raw（Proxy の lifecycle コード）で、予算内。

### 0.4 最終修正パス後の再検証（2026-10-25、cache test / S1 / S5 message）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test（2 回連続） | `npm test` × 2 | **0 / 0** | PASS — **249 files / 2,351 tests**（両方とも全件 PASS） |
| typecheck app / worker / test | `npx tsc -p tsconfig.{app,worker,test}.json --noEmit` | **0 / 0 / 0** | PASS |
| build | `npm run build` | **0** | PASS（3 × tsc + vite 4.14s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 782,654 B raw / 219,906 B gzip |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 911.13 KiB raw / 148.07 KiB gzip |
| cache test 決定化 | `npx vitest run src/hooks/useCalculationCache.test.ts` | **0** | 5 tests。Date.now を月曜 10:00 JST に固定し、48h 前（土曜）が週末 TTL を超えることを固定 |
| S1 非合成 | `npx vitest run src/components/stockTechnicalChartSeries.test.ts` | **0** | 5 tests。非正/非有限 close の行をドロップし、全滅時は空配列 |
| S5 文言 | `npx vitest run src/lib/authNetworkMessage.test.ts src/components/editPasswordNetworkMessage.test.tsx src/components/adminDashboardNetworkMessage.test.tsx` | **0** | 4 tests。auth / EditPasswordModal / AdminDashboard の実入口で統一メッセージを検証 |

補足: 0.3 の `npm test` PASS は実行時刻に依存しており、日曜引け後には `useCalculationCache.test.ts` が fail した。0.4 で同テストを固定時刻に変更し、2 回連続で green を確認した。

### 0.3 S5 修正パス後の再検証（2026-10-25）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test | `npm test` | **0** | PASS — **246 files / 2,345 tests** |
| typecheck app / worker / test | `npx tsc -p tsconfig.{app,worker,test}.json --noEmit` | **0** | PASS |
| build | `npm run build` | **0** | PASS（3 × tsc + vite 4.02s） |
| first-paint gate | `npm run check:first-paint` | **0** | PASS — 782,654 B raw / 219,898 B gzip（予算 900,000 / 250,000） |
| S5 回帰 | `npx vitest run src/components/stockTechnicalChartRequestLifecycle.test.tsx` | **0** | 3 tests。旧実装は fetch に signal を渡さないため、最初の `signals` 待機で成立しない |
| timeout 契約 | `npx vitest run src/lib/apiContract.test.ts` | **0** | 49 tests。deadline は `FetchTimeoutError`、caller abort は素通し |

補足: クライアントの生 `fetch(` は `src/lib/apiContract.ts` の実装 1 箇所のみ（`grep` 済み）。timeout は opt-in（未指定なら期限なし）とし、既存の 8 秒 / 10 秒 / 12 秒の挙動を保持した。

### 0.2 B1 / B2 修正パス後の再検証（2026-10-25）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test | `npm test` | **0** | PASS — **245 files / 2,340 tests**（既存 2,336 + 新規 4） |
| build | `npm run build` | **0** | PASS（3 × tsc + vite 4.05s） |
| worker bundle | `npx wrangler deploy --dry-run --config wrangler.local.jsonc` | **0** | PASS — 911.13 KiB raw / 148.07 KiB gzip、D1/ASSETS バインド解決 |
| B1 回帰 | `npx vitest run src/lib/workerAuthAvailability.test.ts` | **0** | 4 tests。修正前コードでは 503 期待が **403** で fail することを確認 |
| B2 回帰 | 同上 | **0** | 修正前コードでは DDL が **19 → 95 回**に増えて fail することを確認 |

### 0.1 修正パス後の再検証（2026-10-25、S1 / S2 / S9）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（警告 0） |
| test | `npm test` | **0** | PASS — **244 files / 2,336 tests**（8.65s） |
| typecheck app / worker / test | `npm run build` 内の 3 × `tsc --noEmit` | **0** | PASS |
| build | `npm run build` | **0** | PASS（vite 4.08s） |
| S1 回帰 | `npx vitest run src/components/stockTechnicalChartSeries.test.ts` | **0** | 4 tests。close のみの API 応答から OHLCV を生成しないことを型のキー集合で固定 |
| S2 回帰 | `npx vitest run src/hooks/useSimulation.loadingOwnership.test.tsx` | **0** | 修正前コードで **fail**（`loading === true`）することを確認済み |
| S9 回帰 | `npx vitest run src/components/portfolioFxRateDisclosure.test.tsx` | **0** | 2 tests。live / fallback の両方でヘッダーと追加モーダルの注記が同じ来歴を表示（3 箇所は同一の導出値を使用） |

補足:

- テストの skip / todo / アサーション緩和は 0 件（横断 grep 済み）。
- production code の `any` / `@ts-ignore` / `eslint-disable` は 0 件（test double の `any` のみ eslint 設定で許可）。
- リポジトリ直下の `build-output.log` / `lint-output.log` / `test-output.log` / `vitest_results.json` / `*.tsbuildinfo` / `dist/` / `freebuff-sites-build/` はすべて `.gitignore` 済みで未追跡。デバッグ残骸の混入はない。

---

## 1. 調査範囲（実際に精査したファイル）

全 `git ls-files` 対象に対し「全文のアンチパターン横断 grep」＋「危険領域（fetch / storage / JSON / 認証 / timer / listener / SQL / async / 数値計算）の窓読み」を実施し、主要ファイルは全読または実質全読した。以下は本レビューで実際に読んだファイル（グループ単位）。

| 領域 | ファイル |
|---|---|
| Backend | `worker/index.ts`, `worker/internal.ts`, `worker/internal-impl.ts`（9,202 行。全 25 ルートと全 helper を窓読み）, `worker-configuration.d.ts`（生成物） |
| UI シェル / ページ | `src/main.tsx`, `src/App.tsx`, `src/components/{AdminDashboard,PortfolioManagerPage,CalendarPage,ScreenerPage,MarketOverviewPage,StockDetailPage,StockAnalysisPage,IndexBuilderContent,IndexBuilderModal,IndexBuilderPage,ConstituentsTable,SimulationPreview,PerformanceChart,GlobalSearchModal,AuthModal,EditPasswordModal,TutorialPage,Tutorial3DCanvas,Tutorial3DScene,DisclaimerPage,PortfolioPage,StockTechnicalChart,TradingViewChartModal,TradingViewTickerTape,Header,Sidebar,Footer,MobileBottomNav,ThemeHeatmap,ThemeControls,ThemeBreakdown,StatsGrid,RiskMetricsCard,Toast,ModalBase,ConfirmModal,AddStockModal,BenchmarkSelector,IndexSelector,DataFreshness,Skeleton,LoadingScreen,EmptyState,ErrorFallback,TurnstileWidget,RoleRadioGroup,ui,changeTone}.tsx/.ts` |
| Hooks / context | `src/hooks/{useAuth,useBenchmark,useCalculation,useIndices,useLockoutCountdown,useModalFocus,useSimulation}.ts`, `src/contexts/FreshnessContext.tsx` |
| 共通ロジック | `src/lib/{apiContract,auth,ownership,indexEngine,indexSerialization,marketDataService,marketCache,marketFormatter,priceSync,syncCache,portfolioStorage,csv,currency,analytics,chartData,timeframe,navigation,searchNormalize,randomId,weights,downloadFileName,addStockFeedback,pageReload,tradingView,tutorialAccessibility,yahooSymbol}.ts` |
| データ / 型 | `src/data/{indices,macroSchedule,marketConstants,popularStocks,popularStocksData,stockUniverse}.ts`, `src/types/index.ts` |
| DB / データ層 | `schema.sql`, `schema.dev.sql`, `schema.migration.sql`, `seed.sql`, `scripts/apply-migrations.mjs`, `scripts/apply-migrations.d.mts` |
| 設定 / CI | `package.json`, `vite.config.ts`, `eslint.config.js`, `tsconfig{,.app,.test,.worker}.json`, `wrangler.jsonc`, `wrangler.local.jsonc`, `index.html`, `public/{reload-suppress,asset-error-recovery}.js`, `.github/workflows/{ci,deploy}.yml`, `.gitignore`, `README.md`, `dev-commands.md`, `scripts/check-first-paint.mjs` |
| テスト | `src/**/*.test.{ts,tsx}` 241 ファイル（全件を棚卸しし、代表 40+ を精読。ソース文字列検証・skip・弱アサーションの判定は全件 grep） |
| 既存レビュー文書 | `plans/mission-pass1-audit-report.md`, `plans/round2-remediation-ledger.md`, 旧 `docs/REVIEW_ISSUES.md` |

未精査（生成物・バイナリ・依存）: `package-lock.json`, `dist/**`, `freebuff-sites-build/**`, `node_modules/**`。

---

## 2. 課題一覧（重大度順）

### S1 [High | データ来歴 / 表示の正確性] 実 close から合成した OHLCV を「実データ」として描画 — **修正済み 2026-10-25**

- 対応（根本原因）: API 応答を描画型へ写す `buildTechnicalChartSeries` を追加し、`PriceDataPoint` から `open/high/low` を削除、`volume` を「API が返した実値のみ」の optional にした。`/api/calculate` の保存済み Yahoo series は `volume` を実際に含むため（`worker/internal-impl.ts:161-174`, `:8858`, `:8905`）実出来高は描画され、`/api/snapshot` の close のみの系列では出来高ペイン自体を出さない。合成 `dynamicVol` / `prevP` / `1.008` / `0.992` は削除。
- テスト: `src/components/stockTechnicalChartSeries.test.ts`（close のみ→キー集合が `close/date/displayDate/sma25/sma75` のみ、実 volume 保持、0/NaN volume 破棄、破損 close の行をドロップして現在値で補完しないこと、全滅時は空配列）。旧挙動を固定していた `src/lib/stockChartVolumeFix.test.ts` と `src/lib/comprehensiveGoalCodeReviewFulfillmentRound4.test.ts` を新契約へ更新。

- 修正前の箇所: `src/components/StockTechnicalChart.tsx:526-562`（`rawVol` 不在時に `dynamicVol` を生成、`open/high/low` も `prevP` / `p*1.008` / `p*0.992` で合成）、`:570` で `setLocalSeriesIsSynthetic(false)`、`:744` のバッジ条件は `localSeriesIsSynthetic` のみ、`:780` で「参考値（デモ）」を表示。
- 症状: 当時のチャートは API series を `{date, close}` と型付けしながら `volume` を場当たり的に読み、OHLC は常に `prevP` / `1.008` / `0.992` で生成、volume 欠損時は `dynamicVol` を生成していた。`/api/calculate` の保存 series には実 volume が含まれ得る（`worker/internal-impl.ts:2718-2749`, `:9080`）が、`/api/snapshot` は close のみで、どちらも OHLC は持たない（`src/types/index.ts:1-6`）。生成値も「実データ」の見た目で描画され、デモバッジは出ない。`isDemo`（`:274`）は TradingView フォールバック判定にしか使われない。
- 根本原因: チャートが OHLC を要求しているのに API は提供しておらず、volume の有無も型に現れていなかった。**契約を明確化する代わりに UI 側で欠損値を捏造して隠蔽**しており、合成値と実測値の区別がデータ型に存在しなかった。
- 横断: 同種の「欠損を生成で埋める」実装は `StockTechnicalChart.tsx:206-310`（完全フォールバック、こちらはバッジあり）、`useSimulation.ts:839-876`（デモ生成、`usingDemoData` あり）。**バッジ運用は他画面では正しい**ため、S1 は局所的な契約不整合である。
- 後方互換: API のフィールド追加は互換。描画を close のみのラインに落とす場合も、既存の出来高ペインを「推計」と明示すれば互換。
- 修正方針: (a) Worker の series に実 OHLCV を含める、または (b) OHLC が無い場合はライン/終値のみを描画し、合成値を一切表示しない。**採用: (b)**。チャートはライン＋SMA 表示で OHLC を消費しておらず、実 volume は保存 series に既に存在するため、描画型から OHLC を削除し、volume は API 実値のみ optional とした。
- 必須テスト: close のみの series を渡したとき (1) 合成 OHLC/出来高が描画されない、または (2) 推計バッジが必ず出る、のいずれかを固定。実 volume がある場合はその値だけが描画されること。`generateDeterministicHistory` 使用時のみ従来のデモバッジが出ること。

### S2 [Medium | 非同期 / UI 状態] 中断＋キャッシュ高速パスで `loading` が永久に true になり更新ボタンが無効化 — **修正済み 2026-10-25**

- 対応（根本原因）: `abortInFlight` を `loading` の解放責務を持つ所有者にした（中断した controller があれば `setLoading(false)`）。`finally` は `!controller.signal.aborted` ではなく `!isSuperseded()` で判定し、後続リクエストの `setLoading(true)` を古い run が消さない規約に統一。追加→即削除の再現テストは修正前コードで fail することを確認済み。
- テスト: `src/hooks/useSimulation.loadingOwnership.test.tsx`（force 更新中に銘柄追加→削除、`calculate` 呼び出しが増えないこと、`loading === false` のままであること）。既存の `round2UseSimulationRequestIdentity.test.tsx` 3 件も PASS。
- 横断の再確認: `useCalculation` も `!aborted` ガードを持つが、中断は必ず後続 `calculate()` の開始（または `enabled=false` での明示解除）と対になり、loading の所有者が残らない。`AdminDashboard` は中断時に結果行を書かないだけで loading 相当を別に管理しており、同型の恒久 true はない。したがって今回の修正は `useSimulation` に限定した。

- 修正前の箇所: `src/hooks/useSimulation.ts` の `abortInFlight`（旧 `:179-186`）、`hasAllStockData` の高速リターン（旧 `:222-235`）、`setLoading(true)`（旧 `:246`）、`finally`（旧 `:440-441`、`!controller.signal.aborted` のときだけ解除）。
- 症状: 追加銘柄の取得中にその銘柄を削除する等、「中断 → 新しい銘柄集合が既存 universe で充足」の順になると、中断されたリクエストは loading を解除せず、新しい `runSimulation` は高速パスで即 return するため loading が true のまま残る。`SimulationPreview.tsx:285` の更新ボタンが `disabled={loading}`、`:420` でスピナー表示のため、復帰不能。
- 根本原因: `loading` の所有権が「中断されたリクエスト」と「新しい高速パス」に分裂しており、**中断時のクリーンアップを finally の条件分岐に委ねている**。高速パスは自分が loading を引き継いでいないと想定している。
- 横断: 同じ `if (!controller.signal.aborted) setLoading(false)` パターンは `src/hooks/useCalculation.ts:381-386`、`src/components/AdminDashboard.tsx:384-411` にもある。useCalculation は毎回新しい run が finally を持つため実害は出にくいが、**「中断時に状態を放置する」設計は共通**。`AdminDashboard` は abort 時にエラー/行を書かないだけで loading 相当の状態は別管理。
- 修正方針: 高速パスでも `setLoading(false)` を明示する、または中断を「開始」ではなく「所有権の移譲」として扱い、新しい run の冒頭で必ず loading を確定させる。`finally` の aborted ガードは「古い結果を書かない」ためだけに使い、フラグ解除は所有権を持つ run が行う。
- 必須テスト: pending 中の fetch を返すモックで、銘柄追加→即削除（または force 中に削除）を行い、最終的に `loading === false` かつ更新ボタンが有効になること。中断された run が series を上書きしないこと。

### S3 [Medium | 認証 / 障害分類] admin session 検証の D1 障害が 403「管理者権限が必要」に誤分類される（W-01 の未完了箇所） — **修正済み 2026-10-25**

- 対応（根本原因）: `authenticateAdminSession` の catch が `unavailable: true` と `AUTH_SERVICE_UNAVAILABLE_MESSAGE` を返し、`adminAuthFailureResponse` が 429 → 503 → 403 の順で分岐するようにした。従来の 403 は「セッションが無い/無効」「非マスター管理者の master-only 操作」だけに限定され、D1 障害は 503 になる。応答は従来と同じ `{ error }` エンベロープ。
- テスト: `src/lib/workerAuthAvailability.test.ts` の B1 3 件。D1 例外 → 503、セッション欠落 → 403、メモリリミッタ飽和 → 429 を `worker.fetch` から検証。
- 横断: `/api/admin/*` の認証失敗はすべて `adminAuthFailureResponse` を通ることを `grep -n "adminAuthFailureResponse" worker/internal-impl.ts` で確認（定義 1 + 呼び出し 11 箇所）。

- 箇所: `worker/internal-impl.ts:2290-2292`（`authenticateAdminSession` の catch が `unavailable` を立てずに `authenticated:false` を返す）、`:2444-2457`（`adminAuthFailureResponse` は `rateLimited` しか見ず、それ以外は 403）、比較として `:2468`（`passwordAuthFailureResponse` は `unavailable` を 503 に変換済み）。
- 症状: 管理 API のほぼ全ルートが使うセッション検証で D1 が読めないと、ブラウザには「管理者権限が必要です」（403）と表示され、実際の原因（DB 障害）も再試行可否も分からない。W-01 で確立した「障害を権限エラーに潰さない」契約が、**最も頻繁に通るゲートで破れている**。
- 根本原因: `AuthResult.unavailable` の伝播が `authenticatePassword` 系にだけ実装され、`authenticateAdminSession` と `adminAuthFailureResponse` に漏れている。個別対処の積み上げで分類が二極化した。
- 横断: `worker/internal-impl.ts` の `catch` で `authenticated:false` を返す箇所は `:2290` の他、`:2134`（unavailable あり）、`:1643`（unavailable あり）。`unavailable` の消費者は `:2468` のみで、admin 系の応答には存在しない。
- 修正方針: catch で `unavailable: true` を設定し、`adminAuthFailureResponse` に 503 分岐を追加。`/api/admin/*` の全ルートが同じ関数を通ることをテストで固定。
- 必須テスト: `authenticateAdminSession` の D1 例外で 503 と `AUTH_SERVICE_UNAVAILABLE_MESSAGE`、セッション欠落は 403 のまま、レート制限は 429 のまま。

### S4 [Medium | 認証 / リソース] スキーマ初期化の失敗時に毎リクエストで全 DDL を再実行 — **修正済み 2026-10-25**

- 対応（根本原因）: `ensurePasswordTable` の失敗時に isolate 単位の `passwordTableProvisionFailed` を立て、以後は probe も DDL も実行しない。成功時のみ `isPasswordTableEnsured`、失敗時は latch という単一の状態遷移にした。latch は cold start（module 再評価）または `resetPasswordTableEnsured`（テスト）でのみ解除される。
- テスト: `src/lib/workerAuthAvailability.test.ts` の B2。`/api/auth/verify` を繰り返し呼び、失敗する DDL バッチが 1 回だけ実行されること、`sqlite_master` probe が 1 回だけであること、reset 後に再試行できることを検証。
- 注意: これは「永久 latch」であり、同一 isolate 内では一時的な D1 復旧後も再試行しない。要求された「every single authentication attempt での再実行を止める」を優先した設計で、復旧は cold start に委ねる。

- 箇所: `worker/internal-impl.ts:1293-1330`（`ensurePasswordTable` は `isPasswordTableEnsured` が false のままなら `probeSchemaObjects` + 全 `REQUIRED_SCHEMA_STEPS` を再実行。1 ステップでも失敗すると `allRequiredStepsApplied = false` でフラグが立たない）、呼び出しは `:1469, :1521, :1596, :1652, :1949, :2174, :2213, :5942, :6020, :6129`。
- 症状: 未マイグレーション DB や一時的な D1 障害で 1 ステップが失敗すると、以後の認証・管理リクエストごとに約 30 本の DDL と probe クエリが走る。D1 の書き込みクォータ（無料枠）を急速に消費し、障害を増幅する。
- 根本原因: 初期化の成功/失敗を「恒久フラグ」でしか表現しておらず、**失敗に対するバックオフやネガティブキャッシュがない**。部分成功を毎回やり直す設計。
- 横断: `scripts/apply-migrations.mjs` は冪等だが、Worker 側の再試行制御とは独立。`probeSchemaObjects` 自体も毎回 3-4 クエリ。
- 修正方針: 失敗時に isolate 単位の latch を立て、以後は probe も DDL もスキップする。**採用: 時間ベースのバックオフではなく永久 latch**（B2 の要求どおり。cold start / テスト reset でのみ解除）。成功時のみ恒久フラグ。
- 必須テスト: 1 ステップを失敗させた D1 で 2 回目以降の認証が DDL を再実行しないこと（呼び出し回数をアサート）、reset 後に再試行すること、成功でフラグが立つこと。

### S5 [Medium | API 境界 / 非同期] クライアントの API 呼び出しが 7 モジュール・16 箇所に分散し、abort/timeout/エラー形式が不統一 — **修正済み 2026-10-25**

- 箇所: `grep -rn 'fetch("/api/' src` = 16 箇所 / 7 ファイル（初版調査時）。特に `src/components/StockTechnicalChart.tsx` の `/api/sync-prices` と `/api/calculate` は **`signal` も timeout もなく**、unmount 後もリクエストが残った。**S5 完了**: 全呼び出しを `fetchWithNetworkMark` に統一し、Chart の 3 fetch は signal + 8 秒期限を持つ。`useIndices.ts:290-399` は 10 秒 timeout + AbortController + ETag、`TradingViewTickerTape.tsx:263` は signal あり、`AdminDashboard.tsx:606/729/941` の mutation は signal なし。
- 症状: 画面遷移やアンマウント後も fetch が継続し、遅い回線では永久 pending になる。エラー本文の読み取りは `readJsonBody` / `readResponseErrorMessage` / `extractApiErrorMessage` が混在し、同じ HTTP 429 でも画面ごとに文言・扱いが異なる。
- 根本原因: `apiContract.ts` は**型とバリデーション**の単一ソースだが、**HTTP 実行（timeout/abort/JSON/エラー変換）の単一ソースがない**。各コンポーネントが fetch を直接持つ。
- 横断: 上記 7 ファイル。`marketDataService.ts` は自前の timeout/fallback を持ち、`auth.ts` は別実装。共通化の重複が 3 系統。
- 修正方針（採用）: 新しい wrapper を増やさず、既存の `fetchWithNetworkMark` を HTTP 実行の単一ソースに拡張（`ApiRequestInit.timeoutMs`、`FetchTimeoutError`、caller abort の素通し、listener/timer の解放）。timeout は opt-in とし、未指定なら期限なし（既存挙動を変更しない）。8 秒を使う marketDataService / Chart は `DEFAULT_REQUEST_TIMEOUT_MS` を明示、useBenchmark 12 秒 / useIndices 10 秒は既存値を維持。
- 必須テスト: timeout で `FetchTimeoutError`、caller abort で `AbortError` 素通し、Chart の unmount aborted と stale 応答が状態を上書きしないこと、失敗時に「参考値（デモ）」フォールバックが表示されること。→ `apiContract.test.ts` / `stockTechnicalChartRequestLifecycle.test.tsx` で固定。
- 表示文言（製品判断）: transport failure は `NETWORK_UNREACHABLE_MESSAGE`（「サーバーに接続できませんでした。…」）に統一する。これは旧ブラウザ依存文言 `"Failed to fetch"` を置き換える**意図した製品判断**であり、`AdminDashboard` / `EditPasswordModal` / `auth.ts` の catch が `err.message` を表示する全経路で同じ文言になる。`authNetworkMessage.test.ts`（verify/admin login）、`editPasswordNetworkMessage.test.tsx`、`adminDashboardNetworkMessage.test.tsx` が実際の UI / 関数入口でこの文言を固定する（監査で `FetchNetworkError` を素の rejection に戻して 4 件すべて fail することを実測）。
- 監査後の追加修正（body 読み取り期限, 2026-10-25）: `fetchWithNetworkMark` はヘッダ受信後も timer と caller listener を保持し、返却 Response の `json` / `text` / `arrayBuffer` / `blob` / `formData` を期限・caller abort と race させる。`readJsonBody` は `FetchTimeoutError` を再送出し、成功・parse 失敗・timeout・caller abort の全経路で `finally` が timer/listener を解放する。body を読まない early return は `releaseResponse` を呼ぶ（Chart の snapshot/sync/calculate、TickerTape、useIndices 一覧、priceSync、marketDataService、useCalculation）。テスト: `apiContract.test.ts` の 5 件（ヘッダ即時・body 永不完了→`FetchTimeoutError`、正常 body 後の timer 0 / listener 解除、非 JSON body 後も同様、caller abort 中の stalled body 解放、discard 時の release）。旧実装はヘッダ時点で timer を消していたため、stalled body のテストは旧コードでは完了しない。

### S6 [Medium | テスト品質 / 保守性] テストの 39% がリポジトリファイルを読み、実装文字列を固定するメタテストが残る

- 箇所: 例 `src/lib/goalFollowupReview.test.ts:30-42`（`readFileSync` したソースに `"if (!controller.signal.aborted) setPasswordFetchError(errText);"` 等の**行そのもの**を `toContain`）。`src/**` には `comprehensive*` / `goal*` / `audit*` / `review*` / `round*` 命名のテストが **79 ファイル**（2026-10-25 時点）。
- 症状: 振る舞いを検証せず、変数名・空白・コメント・行順を固定する。リファクタのたびに無関係な失敗が出る一方、実際の回帰（S1/S2）は検出できない。テスト実行時間と認知負荷を増やし、修正のたびに「ソース文字列を更新する」圧力を生む。
- 根本原因: 過去レビューの「修正した証跡」をテストとして残す運用が累積し、振る舞いテストへの翻訳が行われていない。テストの目的が「仕様の固定」から「diff の固定」へ drifted。
- 横断（実測）: `readFileSync` を含むテストは **94/250**（2026-10-25 時点）。初版調査時点では `.ts/.tsx` の実装ファイルを直接読むもの **24**、`expect(source).toContain` **52**、`expect(code).toContain` **12**。残りは CSS/SQL/JSON の契約検証で、これは一定の妥当性がある。skip/弱アサーションは 0 件で、テスト基盤自体は健全。
- 補足: 前パスで「カバレッジ毀損を避けるため意図的に保留」と判断済み（`plans/mission-pass1-audit-report.md` §9）。本パスでも削除ではなく**振る舞いテストへの置換**を前提とする。
- 修正方針: (1) 新規テストはソース文字列検証を禁止するレビュー規則、(2) 既存 93 ファイルを対象モジュール単位の振る舞いテストへ段階移行、(3) 文字列でしか担保できない契約（CSP 文字列等）は理由コメント付きで残す。
- 必須テスト: 置換対象ごとに「リファクタで壊れず、実装の回帰で落ちる」ことを確認（例: S2 の loading テストはソース文字列ではなく hook の状態を検証）。

### S7 [Medium | 設計 / 保守性] バックエンドが単一 9,027 行モジュール、クライアントの中核サービスが 3,197 行で Worker からも import

- 箇所: `worker/internal-impl.ts`（9,027 行、25 ルート＋認証＋暗号＋スキーマ＋Yahoo＋カレンダー＋キャッシュ）、`src/lib/marketDataService.ts`（3,197 行。`worker/internal-impl.ts:25-33` が `getStockFundamentals` / `DEFAULT_MARKET_OVERVIEW` / カレンダー生成等を import）、`src/lib/marketDataService.ts` の module-load 副作用（`UPCOMING_EVENTS`）。
- 症状: ルート追加・認証変更・データ生成のどこを触っても 1 ファイル内の広い文脈を読む必要がある。Worker バンドル（910 KiB raw）にクライアント用の静的アンカー・ICS/CSV エクスポート・スクリーナー型まで含まれる。変更の衝突面が大きい。
- 根本原因: 機能追加時に「既存の fetch ハンドラに if を足す」方式が続き、ルート/ドメイン単位のモジュール分割が行われていない。共有ロジックの抽出先が「クライアントの巨大サービス」になっている。
- 横断: UI 側も `AdminDashboard.tsx` 2,967 行、`PortfolioManagerPage.tsx` 2,217 行、`CalendarPage.tsx` 1,443 行、`ScreenerPage.tsx` 1,381 行、`IndexBuilderContent.tsx` 1,295 行、`App.tsx` 1,553 行。一方で `apiContract.ts` / `indexEngine.ts` / `priceSync.ts` / `marketCache.ts` は良好な単一責任モジュールで、抽出の成功例がある。
- 修正方針（段階的・独立出荷）: (1) Worker を `routes/{auth,admin,indices,market,sync}.ts` + `lib/{auth,schema,yahoo,http}.ts` に分割（挙動不変、テストは既存のまま）、(2) `marketDataService` から Worker 専用の純粋関数を `src/lib/marketFallbacks.ts` へ分離し、ICS/CSV は `src/lib/calendarExport.ts` へ、(3) `AdminDashboard` を「パスワード管理」「指数管理」「システム統計」の 3 コンテナに分割。
- 必須テスト: 分割は挙動不変のため既存 2,329 テストが回帰網。加えて各ルートの 200/400/401/403/429/503 マトリクスを 1 本ずつ固定（現状は巨大テストに分散）。

### S8 [Low | セキュリティ / 運用] 無認証 `/api/sync-prices` の乱用面（ticker allowlist なし、quota は IP 単位のみ）

- 箇所: `worker/internal-impl.ts:8549-8560`（認証なし、IP レート制限のみ）、`:8628-8645`（任意の正規 ticker を受け付ける）、`:8676-8715`（`sync_quota` は `ip` + 日付。`getClientIp` は CF-Connecting-IP 優先）。
- 症状: ゲストのチャート表示のために意図的に公開されているが、任意の ticker を Yahoo へフェッチさせるプロキシとして使える。日次 5,000 ticker / IP は IP ローテーションで回避でき、D1 書き込みと Yahoo サブリクエストを消費する。
- 根本原因: 公開エンドポイントの abuse 対策が「IP 単位の件数」だけに依存し、**取得対象の集合（ユーザーが実際に開いた銘柄）に紐付いていない**。
- 横断: `/api/ticker-prices` / `/api/snapshot` も無認証だが読み取り中心。`/api/calculate` も無認証で CPU を使うが、こちらは結果キャッシュがある。
- 判定: 直ちに脆弱性ではない（意図されたゲスト機能）。修正は製品判断。候補は「既知ユニバース（`stockUniverse`）の ticker のみ許可」「同期済み銘柄の再取得はキャッシュのみ」「IP 以外に cookie/ターンタイル証明を要求」。
- 必須テスト（実施する場合）: 未知 ticker の 400、既知 ticker の成功、quota 超過の 429、force の 401。

### S9 [Low | 表示の正確性] 為替フォールバック時に「リアルタイムレート」と表示する箇所が残る — **修正済み 2026-10-25**

- 対応（根本原因）: `fxRate = usdJpyRate ?? DEFAULT_USD_JPY_RATE` / `fxRateIsLive = usdJpyRate !== undefined` を 1 箇所で導出し、ヘッダー（`:1348-1351`）・配当注記（`:1575`、初版の一覧では未記載だった 2 箇所目）・追加モーダル注記（`:2194`）の 3 箇所が同じ来歴を表示するようにした。

- 箇所: `src/components/PortfolioManagerPage.tsx:2187`（常に「リアルタイムレート」と説明）、`:1339-1344`（`usdJpyRate` が無い場合は「基準参考レート」と正しく表示）。
- 症状: USDJPY 取得に失敗して `DEFAULT_USD_JPY_RATE` を使っている場合でも、下部の注記だけはリアルタイムと読める。同じ画面内で表現が矛盾する。
- 根本原因: フォールバック判定が表示コンポーネントごとに再実装され、文言が単一ソースでない。
- 横断: 同一画面内の `:1344`（正しい）と `:2187`（誤り）で二重実装。他画面に同種の為替注記はない。
- 修正方針: `usdJpyRate` の有無で文言を分岐（`:1344` と同じ条件を再利用）。
- 必須テスト: rate 未指定時に「基準参考レート」、指定時に「リアルタイム」が出ること（DOM テスト）。

### S10 [Low | 型設計] `calculatePortfolioSummary` の第 2 引数が Map か number かで意味が変わる — **修正済み 2026-10-25**

- 対応（根本原因）: `PortfolioSummaryOptions` インターフェース（`{ liveQuotes?: ..., usdJpyRate?: number }`）を新設し、`calculatePortfolioSummary` が第 2 引数として options オブジェクトを受け付けるように拡張。既存の `(positions, liveQuotesMap, usdJpyRate)` ポジショナル引数シグネチャも完全互換で維持し、`PortfolioManagerPage.tsx` の呼び出し箇所を options オブジェクトへ移行。
- テスト: `src/lib/portfolioStorage.test.ts` および `src/lib/comprehensiveGoalCodeReviewFixesVerification.test.ts`。

### S11 [Medium | UI / ゼロ除算・NaN防御] `PortfolioManagerPage.tsx` のセクター配分で `totalMarketValue <= 0` 時に NaN% 表示 — **修正済み 2026-10-25**

- 対応（根本原因）: `PortfolioManagerPage.tsx:647` で `totalMarketValue <= 0 || !Number.isFinite(summary.totalMarketValue)` の早期リターンを追加し、`:660` でも `total > 0 ? Number(((item.valueJpy / total) * 100).toFixed(1)) : 0` でゼロ除算・NaN を完全に防護。
- テスト: `src/components/portfolioEnhancements.test.ts` および `src/lib/comprehensiveGoalCodeReviewFixesVerification.test.ts`。

### S12 [Medium | 計算層 / 非有限数・-0防御] `calculateStockDetails` における NaN / -0 伝播 — **修正済み 2026-10-25**

- 対応（根本原因）: `src/lib/analytics.ts` 内の `roundSafe` をモジュールスコープに昇格・エクスポートし、`calculateStockDetails` の `change`, `changePct`, `contributionPt`, `contributionPct` および構成ウェイト計算に適用。破損した価格・ウェイトが渡された場合でも NaN や `-0` を返さず、確実に安全な 0 を返すよう防護。
- テスト: `src/lib/analytics.test.ts` および `src/lib/comprehensiveGoalCodeReviewFixesVerification.test.ts`。

### S13 [Medium | 移行スクリプト / 前提列の存在確認] `apply-migrations.mjs` で `owner_token_issued_at` 列の存在確認なしに backfill SQL 実行 — **修正済み 2026-10-25**

- 対応（根本原因）: `scripts/apply-migrations.mjs:207-211` において、`hasOwnerTokenHash` だけでなく `hasOwnerTokenIssuedAt` の存在（または pending 内での追加）も同時に検証するガードを追加。
- テスト: `src/lib/applyMigrations.test.ts` および `src/lib/comprehensiveGoalCodeReviewFixesVerification.test.ts`。

### S14 [Low | リソース管理 / レスポンスライフサイクル解放] 未読レスポンスにおける `releaseResponse` 呼び出し漏れ — **修正済み 2026-10-25**

- 対応（根本原因）: `useBenchmark.ts`（304 応答時）、`EditPasswordModal.tsx`（`res.ok` 成功時）、`AdminDashboard.tsx`（パスワード削除・有効化トグルの `res.ok` 成功時）において、本文を読まずに完了する経路に `releaseResponse(res)` を追加。タイマーおよび abort リスナーの残留を完全に排除。
- テスト: `src/lib/comprehensiveGoalCodeReviewFixesVerification.test.ts`。

### D1 [Medium | DB / 設定] スキーマ定義が 4 箇所に分散 — **修正済み 2026-10-25**

- 対応（根本原因）: `schema.sql` を唯一の正典とし、`scripts/schema-source.mjs` がパースして Worker 用の `worker/schemaSteps.generated.ts` と `schema.migration.sql` を生成する。Worker の `ensurePasswordTable` は生成物の `REQUIRED_SCHEMA_STEPS` を import するだけで DDL を再定義せず、`scripts/apply-migrations.mjs` も同じパーサから `REQUIRED_MIGRATION_STEPS` を導出する。`PROBED_COLUMN_TABLES` と backfill SQL も導出／共有し、フォールバック内に直書きされていた `snapshot_cache` / `benchmark_cache` の CREATE TABLE も正典ステップを実行するよう置換した。再生成は `npm run db:schema:generate`。
- 等価性の証明: `schema.sql` の変更はコメントのみ（ヘッダと、旧 DB で ALTER が必要な 7 列の `-- @legacy-add`）。生成される DDL は既存の 12 テーブル / 7 索引 / 7 ALTER と同一で、既定値・制約（`CHECK (id = 1)`、`UNIQUE(index_id, ticker)`、`DEFAULT 'user'`、`ON DELETE CASCADE`）を含めてテストで固定した。
- 安全性: `schema.migration.sql` の CREATE はすべて `IF NOT EXISTS`、ALTER は `@legacy-add` の 7 列のみ。既存 DB 向けの推奨経路 `db:migrate:columns` は probe で不足のみ適用し、provision 済み DB では構造変更が 0 件（残るのは旧索引の DROP のみ）であることをテストで固定した。
- テスト: `src/lib/schemaSingleSource.test.ts`（7 件）。正典を独立パーサで再解析し、Worker ステップと CLI ステップを双方向比較する。`schema.migration.sql` は全テーブル・索引・legacy ALTER の包含と「legacy 以外の ALTER が無いこと」を、`schema.dev.sql` は DROP 対象テーブル集合の一致を検証する（migration 側の「余分なテーブル」だけは未検出。下記の残課題）。正典への列追加（未再生成）と Worker ステップへの定義追加の双方で fail することを実測済み（§0.5）。`schemaContract.test.ts` の追加テストが、旧スキーマの DB に生成 migration を実際に適用して列・索引が正典に一致することを検証する。`infrastructureContracts.test.ts` は Worker ソース文字列ではなく生成ステップを検証するよう更新した。

---

## 3. 横断検索の証跡（同種アンチパターンの展開）

| # | クラス | 検索 | 結果 | 展開先 |
|---|---|---|---|---|
| 1 | 欠損値を合成で隠す | `grep -rnE 'dynamicVol|pointVolume|1\.008|1\.012' src` | production code は 0 件（残る 2 件は `stockChartVolumeFix.test.ts` の再発防止 `not.toContain`）。完全フォールバック `StockTechnicalChart.tsx:206-310` は「参考値（デモ）」バッジ付きで意図された参考値 | S1（完了） |
| 2 | 中断時に状態を放置 | `grep -rn 'if (!controller.signal.aborted)' src` | `useSimulation` は所有権ベースへ変更済み。Chart は `isCancelled` + signal の両方で stale 応答を遮断（S5 で追加） | S2 / S5（完了） |
| 3 | 障害を権限エラーに潰す | `grep -n 'unavailable' worker/internal-impl.ts` | `unavailable: true` を立てるのは 4 箇所（password 系 3 + `authenticateAdminSession`）、消費は `passwordAuthFailureResponse` と `adminAuthFailureResponse`（503）。admin 系の consumer なしは解消 | S3（完了） |
| 4 | スキーマの多重定義 | `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` を schema.sql・生成物・script・Worker で比較 | `schema.sql` のみが定義。`worker/schemaSteps.generated.ts` と `schema.migration.sql` は生成物、`apply-migrations.mjs` は実行時導出。直書きの CREATE TABLE は 0 件 | D1（完了） |
| 5 | ソース文字列メタテスト | `grep -rl readFileSync src --include=*.test.ts*` | 94/250 ファイル。review 系命名 79 ファイル（2026-10-25 時点） | S6 |
| 6 | 生 fetch の分散 | `grep -rn '[^a-zA-Z]fetch(' src --include=*.ts --include=*.tsx` | 初版 16 箇所 / 7 モジュール。現在は `apiContract.ts` の transport 実装 1 箇所のみ | S5（完了） |
| 7 | 巨大モジュール | `wc -l` | worker 9,027 / marketDataService 3,197 / AdminDashboard 2,967 / PortfolioManagerPage 2,217 / CalendarPage 1,443 | S7 |
| 8 | 無認証の外部フェッチ | `grep -n 'sync-prices\|MAX_SYNC_TICKERS' worker/internal-impl.ts` | 公開 1 ルート。quota は IP 単位のみ | S8 |
| 9 | 型の union による意味の多重化 | `grep -n 'liveQuotesMap' src` | `portfolioStorage.ts:507` の 1 箇所 | S10 |

---

## 4. 修正ユニット（独立出荷・依存順）

各ユニットは「修正 → 追加テスト（正常/境界/異常/回帰）→ `npm run lint` → `npm test` → `npm run build`」を完遂してから次へ進む。型弱体化・`@ts-ignore`・テスト skip・アサーション緩和は禁止。

### Unit A — データ来歴の是正（S1, S9）— **完了 2026-10-25**
1. ✅ series の描画型から OHLC を削除し、`volume` は API 実値のみ optional。合成値を描画できないことを `stockTechnicalChartSeries.test.ts` で固定。
2. ✅ 為替注記のレートと来歴を 1 箇所で導出（3 箇所が同一ソース）。
3. ✅ テスト: S1/S9 の必須テスト。回帰: `StockTechnicalChart.test.ts`, `marketDataService` 系, `PortfolioManagerPage` 系 を含む全 244 ファイルが PASS。

### Unit B1 — 認証障害分類の完成（S3）— **完了 2026-10-25**
1. ✅ `authenticateAdminSession` の catch に `unavailable` を追加し、`adminAuthFailureResponse` を 429/403/503 の 3 分岐に。
2. ✅ テスト: 全 `/api/admin/*` が同じ関数を通ること、D1 例外で 503、欠落で 403、制限で 429（`workerAuthAvailability.test.ts`）。

### Unit B2 — スキーマ初期化の防御（S4）— **完了 2026-10-25**
1. ✅ `ensurePasswordTable` に失敗 latch を追加（isolate 単位、cold start / reset で解除）。
2. ✅ テスト: S4 の必須テストを `workerAuthAvailability.test.ts` に追加。回帰: `applyMigrations`, `adminLoginSecurity` を含む全 245 ファイルが PASS。

### Unit C — 非同期状態と API 実行の所有権（S2, S5）— **完了 2026-10-25**
1. ✅ S2: `useSimulation` の中断 owner が loading を解放し、`finally` は request identity で判定。再現テスト追加。
2. ✅ S5: 生 fetch 16 箇所を既存 `fetchWithNetworkMark` に集約（新 wrapper なし）。Chart の 3 fetch に signal + 8 秒期限、effect cleanup で abort。重複していた hand-rolled timer（useBenchmark / useIndices / marketDataService）を削除。期限と caller listener は body 読み取り完了まで保持し、body を読まない応答は `releaseResponse` で即時解放する。
3. ✅ S5 テスト: `stockTechnicalChartRequestLifecycle.test.tsx`（4 tests）と `apiContract.test.ts` の timeout/abort 契約。回帰: 全 249 ファイル / 2,351 tests が 2 回連続 PASS（0.4 参照）。

> S5 で追加した timeout は opt-in。`useCalculation` / `AdminDashboard` / `auth.ts` など元々期限のなかった呼び出しは期限なしのまま（挙動不変）。

### Unit D — スキーマ単一ソース（D1）— **完了 2026-10-25**
1. ✅ `scripts/schema-source.mjs` + `scripts/generate-schema-steps.mjs` を追加し、`schema.sql` から `worker/schemaSteps.generated.ts` と `schema.migration.sql` を生成。
2. ✅ Worker の `REQUIRED_SCHEMA_STEPS` / `PROBED_COLUMN_TABLES` / backfill SQL と script の `REQUIRED_MIGRATION_STEPS` を生成・導出に置換し、手書き配列（約 420 行）とフォールバック内の CREATE TABLE 2 箇所を削除。
3. ✅ テスト: `src/lib/schemaSingleSource.test.ts` が正典と Worker/CLI ステップの双方向ドリフトを検出。`src/lib/schemaContract.test.ts` が生成 migration のレガシー DB への実適用を検証。既存 DB の安全性（ALTER は 7 列のみ／provision 済み DB は構造変更なし）を固定。

### Unit E — 構造・テスト資産（S6, S7, S10）
1. Worker ルート分割（挙動不変）。
2. `marketDataService` から Worker 専用純関数と ICS/CSV を分離。
3. `AdminDashboard` を「パスワード管理」「指数管理」「システム統計」の 3 コンテナに分割。
4. メタテスト 93 ファイルを振る舞いテストへ段階置換（削除禁止、同一カバレッジ維持）。
5. `calculatePortfolioSummary` の union をオプションオブジェクトへ。
6. テスト: 既存全件が回帰網。分割ごとにルート契約テストを追加。

### Unit F — 公開同期エンドポイントの abuse 対策（S8・製品判断後）
1. ゲスト同期を維持する場合: ticker allowlist、同期済み限定、quota の重み付け。
2. 不要な場合: 認証必須化（ゲストのチャートはキャッシュのみ）。
3. テスト: S8 の必須テスト。

> 注意: Unit E は規模が大きく、Unit A–D の correctness 修正とは独立に出荷する。Unit E を理由に A–D を遅らせない。

---

## 5. 誤検知・意図された仕様として除外（修正しない）

| 対象 | 判定理由 |
|---|---|
| 同一パスワードの複数ユーザー（最古アカウントが勝つ） | `src/lib/reviewFixes.test.ts:204-236` が「oldest account wins per ORDER BY created_at」を**明示的に仕様として固定**。`src/lib/comprehensiveGoalCodeReviewFixes.test.ts:108` も共有パスワードの作成成功を前提にしている。認証の曖昧さは残るが、既存仕様の変更は本ミッションの禁止事項（後方互換）に触れるため、製品判断なしに修正しない。 |
| フォールバックの `dataAsOf` に現在時刻 | `src/lib/phase1ReviewFixes.test.ts:51-56` が fallback の `dataAsOf` を「parse 可能な文字列」として固定。UI も `参考値（フォールバック）` を併記しており、意図された「生成時刻」表現。名称の曖昧さはあるが挙動変更は不可。 |
| `MAX_AUTH_ROW_VERIFICATIONS = 200` / `MAX_PASSWORD_COLLISION_VERIFICATIONS = 200` | `src/lib/phase1ReviewFixes.test.ts:130-140` が上限動作を固定した CPU 安全弁。撤去ではなく、必要なら上限値の運用変更として扱う。 |
| マスター管理者パスワード変更の `currentPassword` 任意入力 | UI が「現在のパスワード (任意入力)」と明示（`AdminDashboard.tsx:2420`）、空なら送らない（`:948`）。意図された利便性。**残存リスク**（セッション奪取時に再認証なしで rotate 可能）として受容するかは製品判断。修正するなら UI 文言変更を伴う別チケット。 |
| 開発用 `DEFAULT_DEV_ADMIN_SECRET_CODE` / Turnstile テストキー | `isLocalOrTestHost()` が本番ホストで false を返す設計。Host 偽装の可否は Cloudflare 側の保証に依存するため、コード修正対象ではなく運用確認事項。 |
| `sessionStorage` の平文パスワード | ユーザーセッション機構がなく、各 API がパスワードで認証する現行アーキテクチャ。`localStorage` への退避は既に廃止済み（`auth.ts:30-35`）。 |
| `schema.migration.sql` の非冪等 `ALTER TABLE` | 冒頭に「EXACTLY ONCE」と `apply-migrations.mjs` の使用が明記された意図的仕様。`db:migrate` は冪等な `schema.sql` 経由。 |
| `postMessage` の `JSON.parse` | `StockTechnicalChart.tsx:401-413` で try/catch + 形状検証あり。**送信元/origin の検証はない**ため、任意の frame がローカルチャートへのフォールバックを誘発できる（UI 影響のみ・Low）。 |
| `innerHTML = ""` | クリーンアップ目的の空文字代入のみ（`public/asset-error-recovery.js`, `Tutorial3DCanvas` 等）。 |
| 非 null アサーション `!` | 型ガード直後、またはテスト用。実行時例外の経路なし。 |
| SQL のテンプレート補間 | すべて `?` プレースホルダの個数生成、または固定カラム名。ユーザー入力は連結しない。 |
| 3D / TradingView の timer・listener | `Tutorial3DScene.destroy()`（`:952-971`）で RAF/geometry/material/renderer を解放、Canvas の ResizeObserver/context リスナーも解除済み。TradingView も timeout とリスナーの解除を確認。 |
| `/api/sync-prices` の公開 | ゲストのチャート表示に必要。S8 は「乱用面の残余リスク」であり、機能停止させる修正は不可。 |
| `authCache` の 60 秒 TTL 自体 | 障害時の DB 負荷軽減として意図的。共有パスワードの「最古アカウント優先」は §5 のとおりテストで固定された仕様で、TTL の存在は独立した欠陥ではない。 |
| `getClientIp` の `"unknown"` 返却 | CF ヘッダ欠落時に fail-closed で全員を同一バケットにする設計。本番では CF が必ず付与。可用性リスクはあるが、偽装許容より安全側。 |

---

## 6. 未確認・要判断（次の修正パスへの申し送り）

1. ~~**S1 の描画方針**~~: 解決済み。OHLC は描画に不要なため削除し、実出来高のみ API 値を使う。close のみの系列はライン表示。
2. ~~**UI の実機確認**~~: S2 は「追加→即削除」をフックテストで固定し、修正前コードで fail することを確認した（`useSimulation.loadingOwnership.test.tsx`）。S9 はページの DOM テストで両状態を固定した。
3. **Unit E の範囲**: 9,027 行の分割は挙動不変でも大規模。1 PR で行わず、ルート単位で分割する。
4. **S8 の製品判断**: ゲスト同期を維持するなら allowlist/quota の強化、不要なら認証必須化。
5. **パフォーマンス実測**: `/api/stocks/screener` は 1 回のバッチ quote で済むことを確認済み（`worker:4310-4330`）。ただし同時実行時の Yahoo crumb 取得や D1 書き込みの競合は未計測。負荷試験は別途。

---

## 7. このパスの完了条件（次回以降のチェックリスト）

- [ ] §2 の S1–S10 と D1 がすべて「修正済み / 意図的に保留（理由付き）」のいずれかになっている。
- [ ] Unit A–F の必須テストが追加され、`npm test` の件数が減少していない（置換の場合は同等以上）。
- [ ] `npm run lint` / `npm test` / `npm run build` / `npm run check:first-paint` / `wrangler deploy --dry-run` がすべて exit 0。
- [ ] `git status` に調査用の一時ファイル・ログ・デバッグコードが残っていない。
- [ ] `docs/REVIEW_ISSUES.md` の各行に、修正コミットまたは「保留理由」への参照がある。
