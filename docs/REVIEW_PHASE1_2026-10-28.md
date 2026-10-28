# 包括的コードレビュー 第1フェーズ — 全課題インベントリ（2026-10-28）

> 本ファイルは Phase 1（調査・課題リスト作成のみ。**production code 未変更**）の成果物である。
> 修正契約は Phase 2 でこのリストを土台に作成する。前回までの修正契約は `docs/REVIEW_ISSUES.md`
> （2026-10-25 パス、S1–S14 等を修正済み）を参照。本リストは同ファイルで「修正済み」と
> 明記された事項を再検出した場合でも §4 の除外欄に整理し、誤検知として扱う。

---

## 0. ベースライン（2026-10-28 実測）

環境: Windows / Node 24 / `main` ブランチ / 作業ツリー clean（`git status --short` 空）。

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint`（`eslint . --max-warnings=0`） | **0** | PASS（警告 0） |
| test | `npx vitest run` | **0** | PASS — **260 files / 2,456 tests**（12.4s。stderr の Yahoo 429 / D1 lock スタックは workerBugs.test.ts のテストダブルによる期待出力） |
| typecheck (app / worker / test) | `npm run build` 内の 3 × `tsc --noEmit` | **0** | PASS |
| build | `npm run build` | **0** | PASS（vite 5.02s） |

`build-output.log` / `lint-output.log` / `test-output.log` / `vitest_results.json` / `*.tsbuildinfo` は
`.gitignore` 済みの未追跡生成物。調査用の一時ファイルは作成後に削除済みで、ワークツリーは clean。

---

## 1. 調査範囲と手法

| 領域 | 手法 |
|---|---|
| 設定・スキーマ | `package.json`, `vite.config.ts`, `eslint.config.js`, `tsconfig{,.app,.worker,.test}.json`, `wrangler{,.local}.jsonc`, `index.html`, `public/*.js`, `.github/workflows/{ci,deploy}.yml`, `schema.sql`, `schema.dev.sql`, `schema.migration.sql`, `seed.sql`, `scripts/*` を全読 |
| Backend | `worker/index.ts`, `worker/internal.ts`, `worker/internal-impl.ts`（**9,185 行を全行通読**。全ルート・全 helper） |
| API 境界・共通モジュール | `src/lib/apiContract.ts`, `auth.ts`, `indexEngine.ts`, `analytics.ts`, `portfolioStorage.ts`, `indexSerialization.ts`, `priceSync.ts`, `syncCache.ts`, `ownership.ts`, `marketCache.ts`, `csv.ts`, `randomId.ts`, `yahooSymbol.ts`, `downloadFile.ts`, `downloadFileName.ts` を全読。`marketDataService.ts`（3,213 行）は export 面・キャッシュ/フェッチ/サニタイズ経路・ニュース生成部を窓読み＋契約 grep |
| Hooks / context | `useAuth`, `useIndices`, `useCalculation`, `useSimulation`, `useBenchmark`, `FreshnessContext` を全読 |
| UI コンポーネント | 全ファイル横断の危険パターン sweep（fetch 一元化 / listener・timer の対 / storage 保護 / 非 null アサーション / postMessage origin / index キー / レンダー副作用 / dangerouslySetInnerHTML・eval）＋ `App.tsx`, `StockTechnicalChart.tsx`, `MarketOverviewPage.tsx`, `AdminDashboard.tsx`, `PortfolioManagerPage.tsx`, `Toast.tsx`, `GlobalSearchModal.tsx` の危険領域を窓読み。`react-hooks/exhaustive-deps` が `--max-warnings=0` でゲートされているため依存配列バグは構造的に排除済み |
| テスト | 262 ファイルを棚卸し（runner 対象の突合を実施）、skip/only/弱アサーション/ソース文字列ピン/実装文字列固定の全件 grep、代表ファイル精読 |
| 既存レビュー文書 | `docs/REVIEW_ISSUES.md`（前回修正契約）と重複しないよう、修正済み項目は §4 へ分離 |

---

## 2. 課題一覧（重大度順）

### N-1 [Medium | データ来歴 / 表示の正確性] ニュースのフォールバックが実在記事風に提示され、鮮度も偽装される

- **箇所**:
  - `worker/internal-impl.ts:3353-3390`（`fetchLiveMarketOverview` のニュースフォールバック。`news-live-1` 〜 `news-live-4` に架空の見出し・実在媒体名・`getJstTimeStr(5)` 等の「数分前」時刻を付与）
  - `src/lib/marketDataService.ts:248-283`（`buildDefaultMarketNews`。同一の架空4件を `formatDynamicRelativeTime` で相対時刻化）
  - `src/lib/marketDataService.ts:76-83`（`MarketOverviewData.news` の型に **provenance フィールドが存在しない**）
  - `src/components/MarketOverviewPage.tsx:736-775`（「Live Market News Feed」として無バッジ描画）
- **症状**: Yahoo ニュース取得失敗時、固定の架空記事（「日経平均は高水準推移、主要ハイテク・半導体関連株に実需買い」等）が実在媒体名（市場速報 / グローバル金融 / 為替市況 / 株式ニュース）と「5分前」等の**常に新鮮な相対時刻**付きで表示される。資産価格側には `stale` / `dataSource` による来歴開示があるが、news 要素にはそれが無いため、**quotes が live で news だけ失敗した場合**は `dataSource: "live"` のまま捏造記事が「Live」と表示される。
- **根本原因**: S1 と同じ「欠損を捏造値で埋め、実測値と合成値の区別を型に持たない」アンチパターン。`news` 配列の要素型に `isDemoData` / `stale` / 来歴フラグがなく、フォールバックと実記事の区別が構造的に不可能。相対時刻の動的生成が「捏造鮮度」を強化している。
- **妥当性評価**: 根本解決は (a) news 型へ provenance フィールド追加＋UI バッジ（既存の `isDemoData` 運用と同一規律）、または (b) フォールバック記事を廃止して空配列＋「ニュース取得不可」表示。見出し文言の差し替えだけでは表層対処。
- **横断**: `buildDefaultMarketNews`（クライアント側 `DEFAULT_MARKET_OVERVIEW.news`）も同一問題。`dataAsOf` は資産用であり news の捏造鮮度を救わない。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。根本原因（合成値に provenance が無い）を型から解決。
  - news 型に `isSample?: boolean` を追加（`stale` / `isDemoData` と同一規律）。合成は `source: "サンプル"`・`publishedAt: ""`・`publishedTimestamp` なしで出力（worker フォールバック・`buildDefaultMarketNews`・`FALLBACK_MARKET_NEWS_TEMPLATES` の全経路）。id の `news-live-*` も `news-sample-*` に改名。
  - 実記事は配信元供給の `providerPublishTime` がある場合のみ時刻を出力。欠損時に「今」で捏造していた旧行為と、配信元欠損時に「市場速報」を付与していた旧行為（`publisher || "配信元不明"`）も同時に是正。
  - UI はサンプルに琥珀色「サンプル」バッジ（tooltip で実記事でない旨を明示）を付与し、時刻・記事リンク・媒体名を表示しない。実記事で時刻欠損は「配信時刻不明」と表示。
  - 境界 (`normalizeMarketOverview`) は `isSample` を厳密に `true` のみ伝播し、サンプルに同梱された時刻を破棄。
  - 検証: `src/lib/newsProvenance.test.ts` 新規（10 件：フォールバック/取得失敗/時刻欠損/配信元欠損/境界の異常系）＋ `MarketOverviewPage.test.tsx` に UI 2 件、既存の JST・ISO 契約テスト 2 件を決定的な Yahoo テストダブル化（アサーションは維持・厳格化）。lint / vitest 261 files・2,468 tests / build 全 green。

### N-2 [Medium | データ正確性] FOMC「現行誘導目標」が 3 ヶ月 T-Bill 利回りからの推計値で実データ扱いされる

- **箇所**: `worker/internal-impl.ts:4882, :4922, :4930-4937`（`fetchLiveMarketCalendarAsync`。`^IRX`（13 週米財務省証券利回り）の `regularMarketPrice` を `liveFomcRate` とし、`Math.floor(rate * 4) / 4` でレンジ下限を合成して `me.previous = "X% - Y% (現行誘導目標)"`、`me.source = undefined` で LIVE 扱い）
- **症状**: 短期国債利回りを 0.25bp 単位に丸めた**推計レンジ**が、公式の FF 誘導目標レンジ「現行誘導目標」として前回値欄に表示される。政策金利と 3 ヶ月物利回りは予想織り込み等で複数ステップ乖離しうる。指標側は PER 推計に `isEstimatedPer` + 「推計」注記を付ける規律があるのに、ここには推計である旨の表示が一切ない。
- **根本原因**: 派生推計値を「公式前回値」フィールドに書き込み、provenance（`source`）をむしろ除去している。実測・推計の区別がデータに現れない。
- **妥当性評価**: 根本解決は「参考推計」である旨の明示（文言＋`source` の区分、他指標の `isEstimatedPer` 規律と揃える）。指標名を「（参考: 3 ヶ月物利回りベース推計）」等に改める互換的修正も可。レンジ計算の精度改善だけでは来歴問題が残る。
- **横断**: 同じ `fetchLiveMarketCalendarAsync` 内で `^TNX`（10 年債利回り）を CPI イベントの description に「参考指標」と明記して付記している箇所（`:4944-4950` 付近）は**正しい来歴運用の例**であり、FOMC 経路だけが規律から外れている。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。N-3 と同じ `fieldProvenance` で解決。
  - 前回値を `(現行誘導目標)` → `(参考推計: 3ヶ月物利回りベース)` に変更し、`fieldProvenance.previous: "estimated"` を付与（PER の `isEstimatedPer` + 「推計」注記と同一規律）。`me.source = undefined`（LIVE 実データ扱い）は廃止。
  - UI は推計値に「推計」バッジ（tooltip「公式実績ではなく推計値です」）を表示。
  - 検証: `src/lib/macroValueProvenance.test.ts`（^IRX 推計の明示・^IRX 欠損/0/負時の非捏造）＋ UI 3 件。既存のレンジ計算アサーション（"4.25% - 4.50%" 等）は維持。

### N-3 [Medium | データ正確性 / 来歴] マクロ指標の前回値・予想値が固定デフォルトのまま "official" に昇格する

- **箇所**:
  - `src/data/macroSchedule.ts:125-149`（`MACRO_METRICS_DEFAULTS`。BOJ `0.25%`/`0.50%`、FOMC `4.75%`/`4.50%`、雇用統計 `14.2万人` 等の固定値）
  - `worker/internal-impl.ts:4534`（`generateUpcomingMacroEvents` が全マクロに `source: "fallback"` を付与）
  - `worker/internal-impl.ts:5004-5009`（**決算実データが 1 件でも取得できた時点で全マクロイベントの `source` を `"fallback"` → `"official"` に書き換え**）
- **症状**: `previous` / `forecast` は静的定数なのに、無関係な決算実データが 1 件取れた時点でイベント全体が公式扱いになり、UI の来歴表示が「公式実績・予想」に見える。固定値は経過とともに陳腐化する（例: 政策金利改定後の BOJ `previous`）が鮮度管理が無く、更新要否を検知する仕組みも無い。
- **根本原因**: provenance がイベント単位でありフィールド単位でない。「1 つの実データフィールドが静的フィールドを来歴ごと洗浄する」構造。日程（公定表）は official で正しいが、指標値（定数）まで同梱されて同じラベルになる。
- **妥当性評価**: 根本解決はフィールド単位の provenance、またはイベントの `source` を「日程=official / 指標値=reference」に分離すること。**過剰変更に注意**: 日程自体の official 扱いは正当な仕様であり、そこは変更しない。定数の値更新だけでは次回の陳腐化を防げない。
- **横断**: `generateFallbackEarningsEvents`（`:4780` で `source: "fallback"` 付与）と FOMC レート更新経路（N-2）は同じ `CalendarEvent.source` を異なる意味で使っている。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。根本原因（provenance がイベント単位）を N-1 のニュース来歴モデルと一貫した**フィールド単位の来歴**で解決。
  - `CalendarEvent` に `fieldProvenance?: Partial<Record<"previous" | "forecast" | "actual", "reference" | "estimated">>` を追加（未設定 = 実データ、`stale` / `isSample` と同じ「実データでないときだけ出す」規律）。静的デフォルト（`MACRO_METRICS_DEFAULTS`＋GDP インライン定数を含む全生成経路）は `reference` を明示。
  - イベント単位の `source` 昇格（fallback → official）は**日程の来歴として正当に維持**し、値の来歴は洗浄されない（N-3 の核心）。UI は値ごとに「参考値」バッジ（tooltip「実データではなく静的な参考デフォルト値です」）を表示し、実データの値にはバッジを付けない。
  - 境界（`isValidCalendarEvent`）で来歴を既知のキー/区分のみに正規化（不正形状・未知値は破棄 = 実データ扱いの安全側）。
  - 検証: `src/lib/macroValueProvenance.test.ts` 7 件（昇格時の洗浄防止回帰・^IRX 異常系・クライアント生成・境界正規化 3 件）＋ `calendarValueProvenance.test.tsx` UI 3 件。既存テスト 2 件（`macroCalendarLiveAccuracy` / `userRequestedCalendarAndFinancialsFixes`）は FOMC が推計と判明した仕様変更に合わせ、日程 official 昇格のアサーションは維持のまま値の来歴を厳格化。lint / vitest 263 files・2,478 tests / build 全 green。

### N-4 [Medium | テスト基盤] `scripts/apply-migrations.test.mjs` がどのコマンドでも実行されない

- **箇所**: `vite.config.ts:86`（`include: ["src/**/*.{test,spec}.{ts,tsx}", "worker/**/*.{test,spec}.{ts,tsx}"]`）、`package.json`（`node --test` を呼ぶ script が存在しない）、`.github/workflows/ci.yml` / `deploy.yml`（`npm test` のみ実行）
- **症状**: `node:test` 形式のこのテスト（`parseCliArgs` の 5 件）は vitest の include に合致せず、どの npm script・CI ステップからも実行されない。マイグレーション CLI の引数解析の回帰が検知不能なまま。runner 対象の突合チェック（262 ファイル）で、未実行は本ファイルのみと確認（他は `tsconfig.test.json` の名前衝突による誤マッチ）。
- **根本原因**: テストランナーが 2 系統（vitest / node:test）あり、実行対象の管理が「ファイルの置き場所の暗黙の規約」に依存している。「テストファイルが runner 対象外で放置される」ことを検出・防止するゲートが無い。
- **妥当性評価**: 根本解決は (a) vitest へ移設（`scripts/` を include に加えるか、`src/lib` 系と同じくテストを vitest 形式で置く）、または (b) `node --test scripts/` を `npm test` / CI に組み込み、さらに runner 対象外テストの存在を fail させる照合チェックを追加すること。型の弱体化・アサーション緩和は不要。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。(a) vitest への統一（ランナー 1 系統化）で解決。
  - `scripts/apply-migrations.test.mjs` を vitest 形式に移行（検証内容・アサーションは 5 件とも同一に維持）、`vite.config.ts` の include に `scripts/**/*.{test,spec}.{ts,tsx,mjs}` を追加。`npm test` → CI の "Run Tests"（ci.yml / deploy.yml 両方）から実行される。
  - **永続的回帰防止ゲート**: `scripts/check-test-coverage.mjs`（`npm run check:test-coverage`、`npm test` の先頭で実行）が全テスト形状ファイルを棚卸しし、どの runner の include にも合致しないファイルがあれば exit 1 で fail。Phase 1 の一時突合チェックを恒久化した形。
  - ドリフト防止: runner registry は `vite.config.ts` の include と一致することをテストで強制（registry が runner より広い claims になる fail-open を構造的に排除）、`npm test` への組み込みと両 CI ワークフローの `npm test` 実行もテストで固定。
  - 検証: `scripts/check-test-coverage.test.mjs` 17 件（名前衝突 `tsconfig.test.json`・宣言ファイル・拡張子外れのエッジケース、glob マッチング、孤立検出の発火（CLI exit 1＋orphan 名出力）、クリーンツリー exit 0、リポジトリ全体で orphan 0 件の回帰）。lint / npm test 265 files・2,500 tests / build 全 green。

### N-5 [Low | セキュリティ（暗号ハズム）] `generateSecurePassword` のモジュロバイアス

- **箇所**: `src/lib/auth.ts:436-442`（`result += chars.charAt(randomValues[i] % charsLength);`、`charsLength = 54`）
- **症状**: 一様な 32bit 値を 54 で割った剰余で文字を写像しているため（2^32 mod 54 = 22）、先頭側の 22 文字が微小に偏る。パスワードという暗号的用途の生成器としては拒否サンプリングが原則。
- **根本原因**: 剰余写像による非一様化。Web Crypto の getRandomValues は一様だが写像で壊している。
- **妥当性評価**: 拒否サンプリング（`floor(2^32 / 54) * 54` 以上の値を破棄して再抽選）で根本解決。出力形式・長さ・既存パスワードとの互換は完全維持。過剰変更ではない。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。拒否サンプリングで一様性を回復。
  - `src/lib/auth.ts` `generateSecurePassword`: `uniformBound = floor(2^32 / charsLength) * charsLength` 以上の乱数を棄却して引き直す方式に変更。文字セット・デフォルト長・出力形式は完全維持（実際の `charsLength` は 55、`2^32 mod 55 = 26`、棄却率 約 6.1e-9）。非整数・負の長さは `RangeError`、0 は空文字で明確化（呼び出し側の既存用途はデフォルト 10 のみで互換）。
  - 横断確認: `safeRandomId` / `generateOwnerToken` は元々バイアス無し（正例）で変更不要と確認。
  - テスト: `src/lib/generateSecurePassword.test.ts` 9 件（文字集合・長さの契約、10 万サンプルでの全文字出現、ビット列からの直接構成による実装非依存の一様性検証、乱数源例外の伝播、境界値 0・不正長の異常系）。型アサーション・弱化なし。
  - 検証: lint / npm test 268 files・2,516 tests / build 全 green。

### N-6 [Low | 保守性 / API 境界] `useBenchmark` のローカル `parseJsonBody` が「非 JSON 本文」規約の重複実装

- **箇所**: `src/hooks/useBenchmark.ts:106-111`（ローカル `parseJsonBody(text)`）、`:264`（`parseJsonBody(freshText)`）
- **症状**: 「非 JSON 本文の扱い」の単一ソース（`apiContract.readJsonBody`）と等価の規約が 2 箇所に存在する。S5 で確立した HTTP 実行・応答解釈の単一ソース原則からの逸脱で、将来の片側だけの変更が規約分岐を生む。
- **根本原因**: 304 再取得フェッチで `res.text()` を挟んだ経路に既存ヘルパーが組み合わされず、地元実装が生まれた。
- **妥当性評価**: `readJsonBody(freshRes)`（または `parseJsonBody(await res.text())` を `readJsonBody` に一本化）で単一化可能。挙動変更なし。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。非 JSON 本文規約を単一実装へ統一。
  - `apiContract.ts` に `parseJsonText(text)`（JSON.parse を試み、非 JSON は例外にせず `null`）を新設し、`readJsonBody` も内部で `res.text()` → `parseJsonText` を使う形に統一。`useBenchmark.ts` のローカル `parseJsonBody` を削除し、304 再取得フェッチの「本文テキストを既に持つ」経路は `parseJsonText` を共有。エラー形式・挙動（非 JSON = 空と同様に `null`、タイムアウトマーカーの再スロー）は完全維持。
  - テスト: `src/hooks/useBenchmarkBodyParsing.test.tsx` 1 件＋`apiContract.test.ts` の `parseJsonText` / `readJsonBody` 拡張（非 JSON・空本文・malformed JSON・タイムアウト伝播のエッジケース）。
  - 横断展開（同一アンチパターンの刈り取り）: テスト内の fetch モックに `json()` しか持たない擬似 `Response`（`res.text()` 不備）が 9 ファイルに残存していたのを、忠実な `new Response(...)` へ置換（アサーションは一切変更・緩和なし。モックの忠実度修正のみ）。`as unknown as Response` の部分モックは全件解消。
  - 検証: lint / npm test 268 files・2,516 tests / build 全 green。

### N-7 [Low | テスト品質 / 保守性] メタテスト（ソース文字列ピン）の残存 — 既知 S6 バックログの継続

- **箇所**: `readFileSync` 等でリポジトリファイルを読むテスト **88 ファイル**、うち実装文字列を `toContain` で固定するピンが残る **15 ファイル**。例:
  - `src/lib/batch3FixesComprehensiveVerification.test.ts:90, :97, :144`（`const MAX_SEARCH_RESULTS = 80;` 等の行ピン）
  - `src/lib/comprehensiveAuditFixes.test.ts:153-164`
  - `src/components/stockAnalysisPage.test.ts:68`
  - `src/lib/codeReviewGoalFulfillment.test.ts:167`
- **症状**: 変数名・空白・行順を固定するため、無関係なリファクタで fail し、実際の回帰は検出しにくい。`docs/REVIEW_ISSUES.md` §0.8 が残量（純粋文字列ピン 80 ファイル＋描画併用 12 ファイル）として記載済みの S6 バックログが未消化。
- **根本原因**: 振る舞いではなく実装テキストに対する表明。S6 で確立した転換方針（実ページ＋DOM / 純粋関数の振る舞いテスト）の展開が中断されている。
- **妥当性評価**: 既知バックログの継続として正当な課題。S6 の転換パターンに沿って段階的に置換する（`cssVariableCompleteness` 等の「正当な契約ピン」は維持）。
- **状態**: 🔶 **部分対応＋恒久ゲート設置（Phase 2, 2026-10-28）**。根本原因（振る舞いでなく実装テキストへの表明）に対して「転換＋再流入防止」の両輪で解決を開始し、レガシー残量を明示的な管理下に置いた。
  - **網羅棚卸し（機械的・全件）**: `readFileSync`/`?raw` でリポジトリファイルを読むテスト 89 ファイルを精査。fixture の `JSON.parse` 読み込み（データへの表明＝誤検知）と、ソーステキストへの表明（真のメタテスト/契約ピン）を区別し、後者を **1,221 件 / 87 ファイル**として完全棚卸し（内訳: impl-source 50 / mixed-contract 31 / css-contract 3 / sql-contract 2 / config-contract 1。うち 2 ファイルはゲート自試験の fixture 文字列）。従来の抜粋推計（「15 ファイル」等）ではなく、追跡変数（`readSrc` 等のヘルパー・`slice`/`match` 由来の派生スニペット・`.not.toContain`・`indexOf` 位置ピン）まで追跡した実測値。
  - **恒久回帰防止ゲート（check-test-coverage 体系に追加）**: `scripts/check-meta-test-gate.mjs`（`npm run check:meta-test-gate`、`npm test` の先頭ゲート群に組み込み済み）。ソーステキスト変数を追跡してピンを検出し、`scripts/source-pin-registry.json` に未登録のピンがあれば exit 1、登録ファイルのピン増加（予算超過）も fail。**転換（ピン減）は自動で PASS のラチェット設計**で、新規メタテストの再流入を構造的に遮断。検出器自体の回帰防止は `scripts/check-meta-test-gate.test.mjs` 14 件（派生変数・ヘルパー・ネガティブ/位置ピンの検出、fixture データの非検出、未登録/予算超過 fail、リポジトリ全体 green、npm test への組み込み固定）。
  - **転換実績（例示ファイル）**:
    - `batch3FixesComprehensiveVerification.test.ts`（23 → 14 ピン）: ISSUE-13（`const MAX_SEARCH_RESULTS = 80;` 等の行ピン 6 件）と ISSUE-16 のインラインスタイル半分（3 件）を、**実 DOM の振る舞いテスト** `src/components/searchResultClipping.test.tsx` 3 件へ転換（AddStockModal/GlobalSearchModal の 80 行クリップ＋「他 N 件」ガイダンス、SearchInput 消去ボタンの 44px タップターゲット＋入力欄のスペース確保）。ISSUE-16 の CSS 半分は「jsdom は外部 CSS を算出しない」という正当な構造ガードとして理由コメント付きで維持。
    - `stockAnalysisPage.test.ts`（57 → 51 ピン）: props 宣言のテキスト固定 6 件を**型契約の検証**へ転換（`StockAnalysisPageProps` の存在・シグネチャ・optionality をコンパイラが保証、実装テキスト非依存）。lazy-loading ピンはコード分割というバンドル構造契約として明示的な構造ガードに整理。
  - **レガシー残量**: 上記転換分を除く約 1,200 ピンはすべて registry（category＋理由付き）の管理下に置き、既存の保証は全て維持（削除・弱化なし）。転換は今後のパスで registry の budget 縮小として継続できる。
  - 検証: lint / npm test / build 全 green。

### N-8 [Low | リソース効率] `ensurePasswordTable` の同時実行でプロビジョニングが二重に走り得る

- **箇所**: `worker/internal-impl.ts:1293-1330` 付近（`ensurePasswordTable`。成功フラグ `isPasswordTableEnsured` と失敗 latch `passwordTableProvisionFailedAt` は存在するが「実行中」状態が無い）
- **症状**: コールドスタート直後の並行リクエストがそれぞれ probe＋全 DDL ステップを実行しうる。DDL は冪等（`isAlreadyExistsError` で吸収）なため破壊的ではないが、D1 クォータを一時的に余分に消費する。
- **根本原因**: 処理の状態が「未実行 / 成功 / 失敗(latch)」のみで、in-flight な実行の共有（プロミスのメモ化）が表現されていない。
- **妥当性評価**: 実行中プロミスの共有で根本解決。ただし S4/B2 で意図的に選択された「失敗時の恒久 latch ＋ 30 秒クールダウン」設計を壊さないこと。影響が小さいため Low に留める。
- **状態**: ✅ **対応済（Phase 2, 2026-10-28）**。in-flight プロミス共有で二重 DDL を構造的に防止。
  - `worker/internal-impl.ts` `ensurePasswordTable`: 「実行中」状態として in-flight プロミスを module 級で共有し、コールドスタート時の並行リクエストは 1 回の probe＋DDL に合流。失敗時は in-flight をクリアするため、既存の「失敗 latch ＋ 30 秒クールダウンでの再試行」設計（S4/B2）は完全に維持。成功後の即時 return・冪等性も維持。
  - テスト: `src/lib/ensurePasswordTableConcurrency.test.ts` 15 件（並行 N リクエストで DDL が 1 回だけ・全リクエスト成功の競合回帰、失敗時の latch とクールダウン明けの再試行、コールドスタートとプロビジョニング済みの異常系エッジ、同一呼び出し元の冪等再実行）。
  - 検証: lint / npm test 268 files・2,516 tests / build 全 green。

---

## 3. 横断展開の候補（Phase 2 で対象に組み込む観点）

| 根本原因クラス | 展開先 |
|---|---|
| 「合成値に provenance が無い」（N-1/N-2/N-3） | ニュース（両経路）・マクロ指標値・FOMC レート・フォールバック決算（来歴あり・正例）・`getTickerBasePrice` 系デモ生成（`isDemoData` あり・正例）を突合し、来歴フィールドの有無を型レベルで統一する |
| 「runner 対象外テスト」（N-4） | `scripts/*.test.mjs` の将来配置も含めた照合ゲート（CI）化。`node:test` 由来のテストが他に無いか全件確認済み（本 1 件のみ） |
| 「暗号的用途での非一様写像」（N-5） | `safeRandomId`（`getRandomValues` 直用・バイアス無し・正例）、`generateOwnerToken`（同・正例）と規律を揃える |
| 「単一ソース化された契約からの地元実装」（N-6） | `readJsonBody` / `extractApiErrorMessage` の使用箇所を全件 grep し、`JSON.parse(await res.text())` 系の残存経路を一本化 |
| 「メタテスト」（N-7） | S6 残量（88 / 15 ファイル）の振る舞い転換 |

---

## 4. 誤検知・意図仕様・過剰変更として除外したもの

| 項目 | 判定理由 |
|---|---|
| `authenticatePassword` の `MAX_AUTH_ROW_VERIFICATIONS = 200` によるアカウント数上限 | コメント明示の意図的 CPU ガード。超過時は distinct error で診断可能。仕様（拡張性上の既知制限として維持） |
| owner token の `issuedAt: undefined` グランドファーザー処理 | 既存オーナーの締め出し防止という意図設計（コメント明示）。fail-closed 側の破損値処理（→ 0 = 失効）も正しい |
| `verifyTurnstileToken` / `verifyAdminSecretCodeDetailed` のローカル・テスト環境フォールバック | `isLocalOrTestHost` ゲート付きの意図的開発便益。公開ホストでは fail closed |
| `getClientIp` が公開ホストで `x-real-ip` / `x-forwarded-for` を無視し `"unknown"` を返す | C-1 修正済みの意図的 fail-closed。本番は `CF-Connecting-IP` が常に存在 |
| `x-admin-key` の受入継続 | deprecated alias の後方互換（クライアント送信は C-2 で停止済み） |
| `checkedCount` 上限到達時の「アカウント数が認証の検証上限を超え…」 | 前回修正で意図的に導入された診断可能エラー |
| テスト実行時の stderr スタック（Yahoo 429 / D1 lock） | `workerBugs.test.ts` のテストダブルが模擬する期待ログ。全テスト green |
| テスト設定の `@typescript-eslint/no-explicit-any: off` | テストダブル境界の明示的例外。production（非テスト）の `any` / `@ts-ignore` / `eslint-disable` は 0 件を全件 grep で確認 |
| `key={index}` 使用箇所（`Skeleton` / `PerformanceChart` 凡例 / `MarketOverviewPage:640` 等） | 静的リストまたは一括置換されるリストで、並び替わる動的リストではない。実害なし（`GlobalSearchModal:176` は結果一括置換のため同様） |
| `/api/admin/system-stats` の `{ ok, stats, ...stats }` 二重形状 | クライアント互換の意図的形状。過剰変更（形状変更）は後方互換を損なうため除外 |
| worker ルート dispatch のネスト `if` のインデント崩れ | スタイルのみで動作に影響なし。今回の依頼範囲（不具合・改善課題）に含めない |
| `POST /api/indices` の新規作成重複時（同時作成競合）が 500 になる経路 | 極めて狭いレース窓で既に 409/403 系の競合制御が別途成立。表記改善候補に留め、課題には昇格させない |
| `validateBasketItems` の `requireTheme` が空文字 theme を通す点 | クライアントは `sanitizeBasketForRequest` で非空に正規化済み、Worker 保存後の表示もフォールバックあり。実害のある境界違反を確認できず、過剰な契約変更（後方互換損失）を避けるため除外 |

---

## 5. Phase 2 への申し送り（優先順位）

1. **N-1**（ニュース来歴）: 既存の `isDemoData` / `stale` 運用に揃えた型拡張＋UI バッジが最小変更。S1 の方針 (b)「合成を表示しない/明示する」と同じ契約。
2. **N-3**（マクロ provenance のフィールド分離）→ **N-2**（FOMC 推計の明示）: 同一の来歴モデルでまとめて解決できる。
3. **N-4**（runner 対象外テスト）: テスト移設＋照合ゲート。CI 追加のみで可。
4. **N-5 / N-6 / N-8**: 局所的・互換性リスク小。**N-7** は S6 残量の継続として別ロット推奨。

各修正には「エッジケース・異常系・回帰防止」テスト（該当箇所の fail-before / pass-after 実測）を添えること。
型の弱体化・エラー抑制・テストスキップ・アサーション緩和は行わない（本リスト作成時も 0 件）。
