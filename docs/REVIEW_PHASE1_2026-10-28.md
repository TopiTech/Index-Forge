# 包括的コードレビュー 第1フェーズ — 全課題インベントリ（2026-10-28）

> 本ファイルは Phase 1（調査・課題リスト作成）を起源とし、その後の修正状況を反映する**統合台帳**である。
> `plans/mission-pass1-audit-report.md`（W/C/T/D）と `docs/REVIEW_ISSUES.md`（S/D）は履歴資料として保持し、
> 全課題を §0.1 の主表と §0.2 の G-1〜G-9 に畳み込んだ。両者を合わせて単一台帳とし、以後の作業対象はこの台帳の ID のみとする。
> 各修正の根拠・テスト・残課題は各 N セクションと §0.1 を参照。

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

**2026-11-01 再測（N-9 / N-11 修正後）**: `npm run lint` exit 0 / `npm test` **278 files・2,587 tests 全 pass** / `npm run build` exit 0。N-9 の新規 3 テスト、N-11 の新規 5 テスト、既存フィクスチャ修正を含む。

**2026-11-01 再測（N-10 / provider 契約抽出後）**: `npm run lint` exit 0 / `npm test` **280 files・2,594 tests 全 pass** / `npm run build` exit 0（app/worker/test の 3 × `tsc --noEmit` + vite build）。新規は provider module 直接テスト 4 件、UI 3 件、fixture JSON。N-9 の既存 3 件は抽出直後に無変更で pass を確認済み。

**2026-11-01 再測（N-11 追補 / CSV 数値表記・UI 警告）**: `npm run lint` exit 0 / `npm test` **281 files・2,599 tests 全 pass** / `npm run build` exit 0。
N-11 の新規 3 件（単位ポリシー、曖昧行の警告、export→import 境界値 property）、UI 実経路 2 件（mixed 行の警告 toast、all-valid 行の非表示）を含む。

**2026-11-01 最終（G-1〜G-9 + 5 件の追補修復後）**: `npm run lint` exit 0 / `npm test` **283 files・2,618 tests 全 pass**（coverage 283 / orphan 0、meta-test 1,221 pins / 87 files）/ `npm run build` exit 0 / `check:first-paint` exit 0 / `wrangler deploy --dry-run` exit 0。詳細は §0.3。

---

## 0.1 統合台帳（単一の正典）

この表と §0.2 の G-1〜G-9 が本プロジェクトのレビュー課題の**唯一の台帳**である。`plans/mission-pass1-audit-report.md`（W/C/T/D）と
`docs/REVIEW_ISSUES.md`（S/D）は履歴資料として保持し、以下の行に全件を畳み込んだ。台帳外の ID は作業対象にしない。
Pass 1 §4 の横断 8 クラスは独立 ID ではなく、W-01 / W-04 / T-01 に集約済み（表の該当行に反映）。

| ID | 重大度 | 領域 | 状態 | 根拠 / 備考 |
|---|---|---|---|---|
| S1 | High | データ来歴 | **fixed** | 合成 OHLCV を描画型から削除。`stockTechnicalChartSeries` 系テストで固定 |
| S2 | Medium | UI/非同期 | **fixed** | `useSimulation` の中断 owner が loading を解放。request identity テスト |
| S3 | Medium | 認証/障害分類 | **fixed** | admin-only + optional-admin の全経路で `unavailable` を 503 に分類（G-2）。`authFailureClassification.test.ts` が 4 経路を固定 |
| S4 | Medium | 認証/リソース | **fixed** | schema 初期化の失敗 latch + cooldown |
| S5 | Medium | API 境界/非同期 | **fixed** | 16 fetch を `fetchWithNetworkMark` に集約、body 期限/abort を統一 |
| S6 | Medium → **Low** | テスト品質 | **deferred** | N-7 に統合。1,221 ピン / 87 ファイルをゲートで凍結。振る舞い化は独立ロット（§0.2） |
| S7 | Medium | 構造/保守性 | **deferred** | 9,000 行 Worker 等の分割。挙動不変の大規模変更で、機能修正と独立出荷すべき |
| S8 | Low | セキュリティ/運用 | **deferred** | ゲスト同期の allowlist/quota は製品判断。現状は既存挙動を維持 |
| S9 | Low | 表示正確性 | **fixed** | 為替フォールバックの「リアルタイム」表示を是正 |
| S10 | Low | 型設計 | **fixed (compat)** | options object 化。旧 positional シグネチャは後方互換のため意図的に維持。内部 1 呼び出しのみ旧形式（欠陥ではない） |
| S11 | Medium | UI/ゼロ除算 | **fixed** | セクター配分の `total <= 0` / NaN 防御 |
| S12 | Medium | 計算/非有限数 | **fixed** | `roundSafe` で NaN / -0 を遮断 |
| S13 | Medium | 移行スクリプト | **fixed** | backfill 前の列存在確認 |
| S14 | Low | リソース管理 | **fixed** | 未読 Response の `releaseResponse` 漏れ |
| D1 | Medium | DB/設定 | **fixed** | `schema.sql` を正典に生成物を一本化 |
| W-01 | Medium | 認証/エラー形式 | **fixed** | password 認証に加え admin session の optional-admin 4 経路も 503（G-2） |
| W-02 | Medium | 設定/運用 | **fixed** | `wrangler.jsonc` に `triggers.crons` を追加 |
| W-03 | Low | 性能/誤前提 | **fixed** | 存在しない D1 1,000 行上限の前提を削除しページング撤去 |
| W-04 | Low-Medium | API/エラー形式 | **fixed** | password 系 5 経路 + admin session 4 経路を 429/503/401・403 に統一（G-2） |
| C-01 | Low | 型/防御 | **fixed** | `sanitizeAuthSession(session) ?? session` を廃止し、失敗時は保存拒否 |
| T-01 | Medium → **Low** | テスト品質 | **deferred** | N-7 に統合。1,221 ピン / 87 ファイルはゲート/registry 管理下 |
| T-02 | Medium → **Low** | 保守性 | **deferred** | N-7 に統合。命名統合は振る舞い化と同じ独立ロット |
| D-01 | Info | DB/移行 | **false positive** | `schema.migration.sql` は「EXACTLY ONCE」明記の意図仕様。`apply-migrations.mjs` が冪等化 |
| N-1 | Medium | データ来歴 | **fixed** | ニュースの `isSample` 来歴 + サンプルバッジ |
| N-2 | Medium | データ正確性 | **fixed** | FOMC の `^IRX` 推計を `estimated` として明示 |
| N-3 | Medium | データ来歴 | **fixed** | `fieldProvenance` によるフィールド単位の来歴 |
| N-4 | Medium | テスト基盤 | **fixed** | `apply-migrations.test.mjs` を vitest へ移設 + orphan ゲート |
| N-5 | Low | セキュリティ | **fixed** | パスワード生成の剰余バイアスを拒否サンプリングで除去 |
| N-6 | Low | API 境界 | **fixed** | `parseJsonText` / `readJsonBody` に一本化 |
| N-7 | Low | テスト品質 | **deferred** | 1,221 ピン / 87 ファイル。ゲートで再流入は遮断済み。全件変換は独立したテスト近代化ロット（§0.2） |
| N-8 | Low | リソース効率 | **fixed** | `ensurePasswordTable` の in-flight promise 共有 |
| N-9 | High | API/データ正確性 | **fixed** | マクロ provider の unit/multiplier/actual、重複、^IRX 上書きを修正 |
| N-10 | Low | データ正確性 | **fixed** | `revisedPrevious` / `revision` を保持し、改定前の `previous` を維持したまま UI・ICS・CSV に追加表示/出力。CSV は末尾 2 列追加で旧列位置を維持（G-7） |
| N-11 | High | データ層/CSV | **fixed** | 株数・取得単価の捏造、NaN/Infinity/負値/0、曖昧な桁区切り・通貨位置を拒否。UI 警告・round-trip・G-4/G-8 の境界テスト済み |

### 0.1.1 重大度の見直しフラグ

- **T-01 / T-02 / S6**: Pass 1 では Medium だったが、現在は **Low（N-7）**。実行時の不具合ではなくテスト保守性の問題であり、恒久ゲートと registry で再流入を防いでいるため。
- **W-04**: Low-Medium のまま fixed。
- **D-01**: Info のまま **false positive**（意図された移行仕様）。
- **S7**: Medium のまま deferred。機能欠陥ではないが、変更衝突面の大きさは残存リスク。

### 0.1.2 監査上の誤検知（修正不要・証拠付き）

| 対象 | 判定 | 証拠 |
|---|---|---|
| 型ガード直後の非 null `!`（CalendarPage / StatsGrid / StockAnalysisPage） | **false positive** | ガード直後で実行時安全 |
| SQL の `IN (${placeholders})` 等 | **false positive** | すべて `?` プレースホルダ連結。ユーザー入力の直接補間なし |
| `container.innerHTML = ""` | **false positive** | 空文字代入のみ（クリーンアップ） |
| `uiHardening.test.tsx` の `new Function` | **false positive** | サニタイズ検証用テストコード |
| `App.tsx` / `useIndices.ts` の localStorage 生アクセス | **false positive** | 全箇所 try/catch または安全ヘルパー内 |
| setTimeout / addEventListener 36 箇所 | **false positive** | 全箇所でクリーンアップまたは `{once:true}` を確認 |

### 0.2 2026-11-01 再監査（統合台帳の突合結果）

> この節は台帳の主張を現在のコード・テスト・ゲートに突合した結果と、G-1〜G-9 の最終状態を記録する。
> 初回の再監査時点ではソースコードを変更していないが、その後の第2次修復で gap を解消し、下表を更新した。

**ゲート実測（このワークツリー）**:

| チェック | 結果 |
|---|---|
| `npm run lint` | exit 0（`eslint . --max-warnings=0`） |
| `npm test` | exit 0。coverage gate 283 files / orphan 0、meta-test gate 1,221 pins / 87 files、vitest **283 files / 2,618 tests all pass** |
| `npm run build` | exit 0（app / worker / test の 3 × `tsc --noEmit` + vite build 4.07s） |
| `npm run check:first-paint` | exit 0（791,679 B raw / 222,413 B gzip、予算内） |
| `npx wrangler deploy --dry-run --config wrangler.jsonc --outdir <tmp>` | exit 0（32 assets、934.56 KiB / gzip 151.73 KiB、`DB` + `ASSETS` binding） |
| `git diff --check` | exit 0。untracked は意図した provider module / fixture / test のみ（デバッグ用ファイルなし） |

**N-7 の扱い（in-progress → deferred）**: 残量は 87 ファイル / 1,221 ピン（impl-source 50 / mixed-contract 31 / css-contract 3 / sql-contract 2 / config-contract 1）。
`check-meta-test-gate` は未登録ピンと budget 超過を fail させ、転換時は自動で PASS するラチェットとして機能している。
全件の振る舞い化は 87 テストファイルの再実装であり、機能欠陥ではない。既存の保証を弱化せずに一度に行うと回帰リスクが大きいため、
独立したテスト近代化ロットへ**意図的に延期**する（T-01 / T-02 / S6 も同じ扱い）。これは未完了を「fixed」と偽装しないための判断である。

**gap の最終状態（2026-11-01 第2次修復）**:

| ID | 重大度 | 状態 | 根拠 / 症状 |
|---|---|---|---|
| G-1 | **High** | **fixed** | `sanitizeCalendarEvent` を `...(record as unknown as CalendarEvent)` から whitelist 方式へ変更。既知フィールドのみを型検証してコピーし、`previous` / `forecast` / `actual` / `time` / `fullDate` / `description` 等の非文字列は破棄。`src/lib/calendarEventBoundary.test.tsx` が object / array / number / null / nested の hostile shape を実ページで描画し、例外なく有効値を保持することを固定。 |
| G-2 | **Medium** | **fixed** | optional-admin 4 経路を含む admin-session の全呼び出しで `unavailable` を 503 に分類。`src/lib/authFailureClassification.test.ts` が 4 経路の route-level 応答を固定。W-01 / W-04 / S3 も **fixed** へ。 |
| G-3 | **Medium** | **fixed** | `sanitizeStoredPositions` が読み込み時に重複 id を再採番。ランダム再発行は最大 8 回で打ち切り、決定的な id 源でも停止するよう `${storedId}-2`, `-3`, … のフォールバックへ。`persistenceHardening.test.ts` が重複 2 件の削除回帰、`portfolioIdRepairBound.test.ts` が固定 id 源での停止・一意性・再現性を固定。 |
| G-4 | **Medium** | **fixed** | `parseNumericValue` は通貨記号を前置のみ許可し、桁区切りを正規表現で検証してからカンマを除去。符号は通貨の前後どちらでも許可（`-¥5,000` / `¥-5,000` は同じ -5000）。`1$2` / `1 2` / `1,2,3` / `2,50,0` / `1.000,5` / `100%`（field policy 外）は NaN。`portfolioCsvValidation.test.ts` の grouping テストで fail-before を固定。 |
| G-5 | **Medium** | **fixed** | `handleImportCsv` は選択時に `fileInputRef.current.value` を即時クリアし、同一ファイルの再選択でも `change` が発火する。単一の `FileReader` owner・単調増加 sequence・unmount cleanup を持ち、新規選択時に旧 read を `abort()`。`portfolioCsvImportToast.test.tsx` が「同一ファイル再選択」「A 読込中に B 選択 → A の遅延 callback を無視」「unmount 後は handler 自体に入らず setPositions も走らない」を固定。 |
| G-6 | Low | **fixed** | provider マッピングと `sanitizeCalendarEvent` の両方で `revision` を `revisedPrevious` に従属させ、改定値なしの回数を破棄。`calendarEventBoundary.test.tsx` が `revisedPrevious: null, revision: 1` → `revision` 欠落を固定。 |
| G-7 | Low | **fixed** | 製品判断: 改定後値は additive に出力する。ICS は `【改定後前回値】…（N回改定）` を追加し、CSV は末尾に `改定後前回値` / `改定回数` の 2 列を追加（旧 14 列の位置は不変）。`calendarEnhancedFeatures.test.ts` が両形式に加え、旧 14 列だけを読む CSV consumer の値一致と、既知 `【…】` のみを読む ICS consumer の無影響を固定。 |
| G-8 | Low | **fixed** | 汎用ヒントに偶然一致する `toContain("100株")` / `toContain("2,500円")` を削除し、`スキップした行: 3` と実データ（有効行のみ）を検証。UI テストも同じ行番号表明に統一。 |
| G-9 | Low | **fixed** | `worker/macroCalendarProvider.ts` の重複説明を削除し、N-10 / N-11 の状態・行番号・テスト件数を現行コードに合わせて更新。N-11 の古い「partial」記述と G-4/G-8 の未解決記述を解消。 |

**矛盾のない完了範囲**: S1 / S2 / S3 / S4 / S5 / S9 / S11 / S12 / S13 / S14 / D1 / W-01 / W-02 / W-03 / W-04 / C-01 / N-1〜N-6 / N-8〜N-11 は、コードとテストの実体を確認できた。
G-1〜G-9 はすべて **fixed**。N-7 / T-01 / T-02 / S6 は **deferred**、S7 / S8 は従来どおり **deferred**、D-01 は **false positive**。

### 0.3 G-1〜G-9 + 追補 5 件修復後の最終ゲート（2026-11-01 実測）

| チェック | コマンド | 終了コード | 結果 |
|---|---|---|---|
| lint | `npm run lint` | **0** | PASS（`eslint . --max-warnings=0`、警告 0） |
| full test | `npm test` | **0** | coverage **283 files / orphan 0**、meta-test **1,221 pins / 87 files**、vitest **283 files / 2,618 tests** 全 pass |
| typecheck + build | `npm run build` | **0** | app / worker / test の 3 × `tsc --noEmit` + vite build 4.07s |
| first paint | `npm run check:first-paint` | **0** | 791,679 B raw / 222,413 B gzip（予算内） |
| Worker bundle | `npx wrangler deploy --dry-run --config wrangler.jsonc --outdir <tmp>` | **0** | 32 assets、934.56 KiB / gzip 151.73 KiB、`DB` + `ASSETS` binding |
| whitespace / residue | `git diff --check` / `git status --short` | **0** | diff check clean。未追跡は意図した module・fixture・テストのみ |

**各 gap の fail-before 証跡**:

| ID | fail-before となる旧挙動 | 現在の固定テスト |
|---|---|---|
| G-1 | `previous: {}` が sanitize を通過し React が `Objects are not valid as a React child` で落ちる | `calendarEventBoundary.test.tsx`（pure boundary 4 件 + 実ページ 2 件） |
| G-2 | D1 障害時の admin-session 検証が 403 に潰れる | `authFailureClassification.test.ts`（4 経路 + 既存分類） |
| G-3 | 重複 id の 2 件が両方返り、1 件削除で両方消える／決定的 id 源では再発行が停止しない | `persistenceHardening.test.ts` + `portfolioIdRepairBound.test.ts`（load 正規化 / delete 回帰 / 上限付き fallback） |
| G-4 | `1$2`→12、`1 2`→12、`1,2,3`→123、`1.000,5`→1.0005、`-¥5,000` を拒否 | `portfolioCsvValidation.test.ts`（grouping / currency / sign / suffix の境界） |
| G-5 | A の遅延 callback が B を上書き、unmount 後も setState、同一ファイル再選択が無反応 | `portfolioCsvImportToast.test.tsx`（same-file / latest-wins / abort / handler spy） |
| G-6 | `revisedPrevious` なしで `revision` だけが残る | `calendarEventBoundary.test.tsx` + provider mapping |
| G-7 | ICS / CSV に改定後値・回数が出ない／追加列・行が既存 consumer を壊す | `calendarEnhancedFeatures.test.ts`（両形式 + 旧 14 列 CSV consumer + ICS 既知フィールド consumer） |
| G-8 | `toContain("100株")` が汎用ヒントに一致し、skip 値を検証していない | `portfolioCsvValidation.test.ts` + UI test の行番号表明 |
| G-9 | 重複コメント・古い行番号・partial 表記 | 本節と N-10 / N-11 を現行コードに更新 |

**禁止事項の遵守**: 追加した修正に `any` / 型アサーションによる沈黙 / `eslint-disable` 等の抑制コメント / `skip`・`only` / アサーションの弱化はない。既存テストの期待値変更は、G-6 の「改定値なしの回数は無意味」という仕様変更と G-7 の additive export に限定し、旧挙動の固定を残していない。

---

## 1. 調査範囲と手法

| 領域 | 手法 |
|---|---|
| 設定・スキーマ | `package.json`, `vite.config.ts`, `eslint.config.js`, `tsconfig{,.app,.worker,.test}.json`, `wrangler{,.local}.jsonc`, `index.html`, `public/*.js`, `.github/workflows/{ci,deploy}.yml`, `schema.sql`, `schema.dev.sql`, `schema.migration.sql`, `seed.sql`, `scripts/*` を全読 |
| Backend | `worker/index.ts`, `worker/internal.ts`, `worker/internal-impl.ts`（**約9,500行を全行通読**。全ルート・全 helper。N-9 修正で行数増） |
| API 境界・共通モジュール | `src/lib/apiContract.ts`, `auth.ts`, `indexEngine.ts`, `analytics.ts`, `portfolioStorage.ts`, `indexSerialization.ts`, `priceSync.ts`, `syncCache.ts`, `ownership.ts`, `marketCache.ts`, `csv.ts`, `randomId.ts`, `yahooSymbol.ts`, `downloadFile.ts`, `downloadFileName.ts` を全読。`marketDataService.ts`（約3,500 行）は export 面・キャッシュ/フェッチ/サニタイズ経路・ニュース生成部を窓読み＋契約 grep |
| Hooks / context | `useAuth`, `useIndices`, `useCalculation`, `useSimulation`, `useBenchmark`, `FreshnessContext` を全読 |
| UI コンポーネント | 全ファイル横断の危険パターン sweep（fetch 一元化 / listener・timer の対 / storage 保護 / 非 null アサーション / postMessage origin / index キー / レンダー副作用 / dangerouslySetInnerHTML・eval）＋ `App.tsx`, `StockTechnicalChart.tsx`, `MarketOverviewPage.tsx`, `AdminDashboard.tsx`, `PortfolioManagerPage.tsx`, `Toast.tsx`, `GlobalSearchModal.tsx` の危険領域を窓読み。`react-hooks/exhaustive-deps` が `--max-warnings=0` でゲートされているため依存配列バグは構造的に排除済み |
| テスト | 全テストファイル（最終 283 ファイル、2026-11-01）を棚卸し（runner 対象の突合を実施）、skip/only/弱アサーション/ソース文字列ピン/実装文字列固定の全件 grep、代表ファイル精読 |
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

- **箇所**: 実測 **87 ファイル / 1,221 ピン**（`node scripts/check-meta-test-gate.mjs --report`、2026-11-01）。旧記載の「88 ファイル / 15 ファイル」は推計で、現在の registry 実測と一致しない。例:
  - `src/lib/batch3FixesComprehensiveVerification.test.ts:90, :97, :144`（`const MAX_SEARCH_RESULTS = 80;` 等の行ピン）
  - `src/lib/comprehensiveAuditFixes.test.ts:153-164`
  - `src/components/stockAnalysisPage.test.ts:68`
  - `src/lib/codeReviewGoalFulfillment.test.ts:167`
- **症状**: 変数名・空白・行順を固定するため、無関係なリファクタで fail し、実際の回帰は検出しにくい。`docs/REVIEW_ISSUES.md` §0.8 が残量（純粋文字列ピン 80 ファイル＋描画併用 12 ファイル）として記載済みの S6 バックログが未消化。
- **根本原因**: 振る舞いではなく実装テキストに対する表明。S6 で確立した転換方針（実ページ＋DOM / 純粋関数の振る舞いテスト）の展開が中断されている。
- **妥当性評価**: 既知バックログの継続として正当な課題。S6 の転換パターンに沿って段階的に置換する（`cssVariableCompleteness` 等の「正当な契約ピン」は維持）。
- **状態**: ⏸ **deferred（2026-11-01 再監査で in-progress から変更）**。恒久ゲートは設置済みで再流入は止まっているが、残る 1,221 ピン / 87 ファイルの全件変換は独立したテスト近代化ロットであり、機能修正サイクルとは分離する。既存の保証は削除・弱化していない。
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

### N-9 [High | API境界・データ正確性] ライブ・マクロカレンダーの provider 契約（unit / multiplier / actual）を無視し、値の桁・結果・予想を誤表示する

- **箇所**:
  - `worker/internal-impl.ts:4879-4998`（`MacroCalendarApiItem` と `parseMacroCalendarApiItem`。従来は `as Array<{...}>` で無検証に取り込み、`unit` / `multiplier` / `digits` を捨てていた）
  - `worker/internal-impl.ts:5032`（FOMC の Press Conference 行も「政策金利発表」として二重生成）
  - `worker/internal-impl.ts:5051-5132`（全フィールドに `%` を付与。`actual` を `CalendarEvent.actual` へ渡さず、FOMC では `actual` を `forecast` の代替に使用）
  - `worker/internal-impl.ts:5264-5291`（`^IRX` の参考推計が provider の実 `previous` / `actual` を無条件に上書き）
- **症状**: 実 API は非農業部門雇用者数を「千人」単位（例: `previous: 162`, `forecast: 52`, `actual: 29`）で返すが、UI は `162万人` / `52万人` と表示し、実際の 10 倍の桁になっていた。`actual` は常に欠落し、FOMC では結果 `4` が「市場予想 4%」として表示された。さらに同日の `FOMC Press Conference` 行が 2 件目の政策金利イベントとして生成され、`^IRX` が取得できた場合は provider の公式 `previous` / `actual` まで「参考推計」に置換されていた。
- **根本原因**: 外部 provider の数値契約（`unit` / `multiplier` / `digits` / `actual`）を型・検証・整形のどこにも持たず、「数値＝%」と決め打ちしていた。加えて、参考推計の適用条件が「イベント種別」だけで、フィールドが実データかどうか（`fieldProvenance`）を見ていなかった。
- **妥当性評価**: 根本解決は (a) provider 行を実行時検証して単位メタデータを保持し、(b) 単位に応じた単一フォーマッタで `previous` / `forecast` / `actual` を整形し、(c) 記者会見行を除外し、(d) `^IRX` は provider 値が無いフィールドにだけ適用すること。イベント ID・`CalendarEvent` の文字列契約・既存フォールバックは維持でき、後方互換を損なわない。
- **横断**: `src/lib/userRequestedThreeIssuesFixes.test.ts` の既存フィクスチャが実 provider と異なる「14.2 / 15.0（万人）」を固定しており、誤契約をテストが追認していた。実 provider の 162 / 55 に修正して期待値を 16.2 / 5.5 万人へ厳格化した（アサーションの削除・緩和ではない）。
- **状態**: ✅ **対応済（2026-11-01）**。
  - provider 行を `unknown` → `isRecord` → 明示的な `MacroCalendarApiItem` へ実行時検証。数値は finite のみ採用し、不正行は 1 件ずつ捨てて有効行を失わない。
  - `formatMacroCalendarValue` を新設。`percent` は `%`、`job` + `thousands` は `/10` して `万人`、`job` + `millions` は `*100` して `万人`、`none` + `thousands` は `千人` として整形。`digits` は上限、値自身の精度は最大 6 桁まで保持する（BoJ の 1.25 を digits=1 で 1.3 に丸めない）。
  - `actual` を `CalendarEvent.actual` へ伝播。FOMC の `forecast` に `actual` を流用する分岐を削除。
  - `press conference` 行をスキップし、同日の重複 FOMC イベントを排除。
  - `^IRX` 上書きは、`actual` が無く、かつ対象フィールドの `fieldProvenance` が未設定（＝provider 実データ）でない場合だけに限定。provider の `previous` / `actual` は保持し、欠損フィールドのみ参考推計/「市場予想集計中」にする。
  - 検証: `src/lib/macroCalendarProviderContract.test.ts` 新規 3 件（単位・actual・記者会見重複・不正行・^IRX 非上書き）、既存 `userRequestedThreeIssuesFixes.test.ts` の実 provider 単位への修正。**fail-before**: 旧実装では 162→`162万人`、actual 欠落、FOMC 2 件、^IRX 上書きで fail する。lint 0 / full vitest 277 files・2,582 tests / build 0。
  - **2026-11-01 追補（抽出）**: provider 契約を `worker/macroCalendarProvider.ts` へ挙動不変で分離。`MacroCalendarApiItem` / `parseMacroCalendarApiItem` / `formatMacroCalendarValue` が Worker 全体を import せずに直接テストできる。抽出直後に既存 `macroCalendarProviderContract.test.ts` を**無変更**で実行し 3 件 pass を確認してから N-10 の変更を加えた。

### N-10 [Low | データ正確性] provider の `revisedPrevious` / `revision` を無視し、改定後の前回値と改定回数を表示しない

- **箇所**: `worker/macroCalendarProvider.ts:27-119`（provider 契約・検証・整形）、`worker/internal-impl.ts:4943-4974`（live マッピング）、`src/lib/marketDataService.ts:188-193`（`CalendarEvent`）と `:2722-2738`（API/キャッシュ境界）、`:3430-3434` / `:3502-3503`（ICS/CSV）、`src/components/CalendarPage.tsx:75-96`（表示 helper）と `:944-952` / `:1293-1315`（一覧・詳細モーダル）。
- **症状**: 実 API は `previous: 162` と `revisedPrevious: 133`, `revision: 0` のように改定前後を併記するが、UI は改定前の 162（16.2万人）を「前回値」として表示する。改定後の公式値 133（13.3万人）や改定回数は失われる。
- **根本原因**: provider 契約のうち `revisedPrevious` / `revision` をモデル化していない。N-9 と同じ「provider フィールドの欠落」クラスだが、どちらを「前回」と定義するかは表示仕様の判断を伴う。
- **妥当性評価（表示仕様の決定）**: **`previous` は provider の改定前値のまま維持し、`revisedPrevious` / `revision` を省略可能な追加フィールドとして一覧・詳細に併記する**。
  - 理由 1: 既存の `previous` を「前回値」として参照する consumer / テスト / CSV・ICS 出力の意味を変えない。新フィールドを無視する consumer は従来どおり動く（後方互換）。
  - 理由 2: provider は `revision: 0` でも `revisedPrevious` が異なる値を返すため、「`revision > 0` のときだけ `previous` を置換する」と改定値が再び失われる。値と回数を独立に保持する。
  - 理由 3: 改定前後を並べることで、利用者は「何が改定されたか」を比較できる。改定後を `previous` に上書きすると比較対象が消える。
  - 表示: 一覧は `改定後 13.3万人（1回改定）`、詳細は前回値セルの下に同じラベル。`revision` が 0/未設定なら回数を捏造せず `改定後 13.3万人` のみ。
- **互換性**: `CalendarEvent.revisedPrevious?` / `revision?` は optional。`previous` / `forecast` / `actual` の型・値は不変。provider に改定情報が無い場合は両フィールドを付与しない。
- **状態**: ✅ **対応済（2026-11-01）**。
  - `MacroCalendarApiItem` に `revisedPrevious: number | null` / `revision: number | null` を追加。`revisedPrevious` は finite のみ、`revision` は 0 以上の整数のみ採用し、文字列・負値・小数・null は欠損として扱う。
  - live マッピングは `previous` と `revisedPrevious` の両方が存在する場合だけ改定後値を整形して付与（`previous` が無いのに改定後だけを出すと、^IRX の参考推計と混ざるため）。`revision` は provider の値をそのまま保持。
  - API/キャッシュ境界の `sanitizeCalendarEvent` は全既知フィールドを whitelist 化し、`revisedPrevious` を非空文字列に trim、`revision` を 0 以上の整数に限定。`previous` / `forecast` / `actual` 等の非文字列も破棄する（G-1）。
  - UI は `revisedPreviousLabel` / `RevisedPreviousNote` に集約し、一覧・詳細モーダルの両方で同じ文言を表示。
  - ICS は `【改定後前回値】` 行を追加、CSV は末尾 2 列（`改定後前回値`, `改定回数`）を追加。旧 14 列の位置は変えず、改定情報を無視する consumer は従来どおり動く（G-7）。`calendarEnhancedFeatures.test.ts` は旧 14 列だけをヘッダーで読む CSV consumer の値一致と、既知 `【…】` キーだけを読む ICS consumer が追加行を無視することを固定している。
  - 検証: `src/lib/__fixtures__/macroCalendarProvider.json` に改定前後・unit/multiplier 全variantの fixture を追加。`src/lib/macroCalendarProviderModule.test.ts` 4 件（直接整形・parser・live 伝播・境界正規化）、`src/components/calendarRevisedPrevious.test.tsx` 3 件（一覧・revision 0・詳細）。**fail-before 実測**: 実装前に 5 件（live 伝播・境界・UI 3 件）が fail し、実装後に 10/10 pass（既存 N-9 3 件を含む）。
  - 検証: §0.3 の最終ゲートを参照。

### N-11 [High | データ層・CSV/数値境界] 不正な保有株数・取得単価を 100 / 1000 で捏造して取り込む

- **箇所**:
  - `src/lib/indexSerialization.ts:276-359`（`parseNumericValue`。`parseFloat` が `"12abc"` を 12 として受理し、`Infinity`/overflow を有限値として扱っていた）
  - `src/lib/indexSerialization.ts:490-620`（`deserializePortfolioFromCsv`。株数・取得単価の欠損/NaN/Infinity/負値/0 を `100` / `1000` に置換）
  - `src/components/PortfolioManagerPage.tsx:618-685`（成功時の skipped-row warning を `info` として表示し、捏造値をそのまま保有リストへ反映）
- **症状**: `shares` が `abc`/`Infinity`/`-5`/空、`averageCost` が `NaN`/`Infinity`/`-1`/`0` の行が、それぞれ `100株` / `1000円` の保有としてインポートされ、評価額・損益・税計算の基礎が捏造される。`parseFloat` の前方一致で `"100abc"` も 100 と解釈され、破損セルが黙って通っていた。
- **根本原因**: CSV の数値セルを「表示用の緩い文字列」として扱い、データ層の不変条件（`shares > 0`、`averageCost > 0`）を満たさない行を既定値で補完していた。既定値は UI のプレースホルダではなく、実在しない保有データ。
- **妥当性評価**: 根本解決は (a) 数値セル全体が数値であることを検証し、(b) 不変条件を満たさない行をスキップして行番号付きで通知し、(c) 有効行だけを返すこと。既定値の補完は行わない。既存の正常 CSV の往復・全角/通貨/カンマ対応は維持する。0 円取得（無償譲渡株）を許容するかは `sanitizePosition` のデータモデル判断であり、今回は現行の「取得単価は正の数」不変条件に合わせてスキップする（許容するなら別課題で sanitize と UI を同時に変更する）。
- **数値表記ポリシー（2026-11-01 追補）**: 旧 `parseFloat` は `100株` / `100円` / `120 USD` のような**末尾に単位を持つセル**を受け入れていたため、単純な厳格化は入力契約の暗黙の縮小になる。証拠は次の通り。
  - アプリ自身の export は `serializePortfolioToCsv` が `String(shares)` / `String(averageCost)` を書くだけで、単位を付けない（`src/lib/indexSerialization.ts:474-487`）。したがって export→import の round-trip に単位は不要。
  - 文書化された入力形式はヘッダー `コード,銘柄名,保有株数,取得単価,取得日,メモ` と「正の数」のみで、サンプル CSV は repo に存在しない（`find -iname '*.csv'` は 0 件）。
  - 既存テストは `¥ 5,000` などの通貨**前置**と全角・カンマを明示的にサポートし、`100円` は N-11 で NaN を固定していた。これは「単位付きセルを許すか」を未決定のまま strict 側へ倒しただけだった。
  - 判断: **portfolio の株数は `株`、取得単価は `円` / `JPY` / `ドル` / `USD` / `米ドル` を末尾に限り明示的に許可する**。汎用 `parseNumericValue` の既定は厳格なまま（basket weight は `%` を末尾に限り許可）。これにより旧 parser が受けていた実用的な手入力表記を維持しつつ、`100株abc` / `100円円` / `約100` は不正として拒否する。
  - **桁区切り・通貨位置の追加決定（G-4）**: 通貨記号は前置のみ、桁区切りは `\d{1,3}(,\d{3})+` を満たす場合のみ許可し、検証後にカンマを除去して `Number` へ渡す。符号は通貨の前後どちらでも許可し、`-¥5,000` / `¥-5,000` は同じ `-5000` になる（符号を落とさない）。`1$2` / `1 2` / `1,2,3` / `2,50,0` / `1.000,5` / `¥¥100` / `$--100` はすべて NaN。portfolio の「正の数」不変条件は別途 negative 行を skip する。
  - エラーメッセージは受理する表記を明示する: `保有株数は正の数（例: 100 / 100株）、取得単価は正の数（例: 2500 / 2,500円）である必要があります`。曖昧値の行は行番号付きでこのメッセージに含める。
- **横断**: `parseNumericValue` はバスケット CSV の比率にも使われるため、既定の厳格性は両経路に効く。単位許可は `NumericParseOptions.allowedSuffixes` を渡した portfolio 経路だけに限定し、basket の weight へ単位解釈が漏れない。CSV 以外の `sanitizePosition` は元々 NaN/Infinity/負値を拒否しており、同じ不変条件を輸入境界にも適用した形。
- **状態**: ✅ **fixed（2026-11-01 第2次修復で G-4/G-8 を解消）**。捏造（100/1000）、NaN/Infinity/負値/0、曖昧な桁区切り・通貨位置、UI 警告欠落のすべてを修正。
  - `parseNumericValue` を厳格化。全角数字・通貨・カンマ・負号の正規化は維持しつつ、通貨は前置のみ、桁区切りは 3 桁グループのみを許可し、検証後のカンマだけを除去。`12abc` / `Infinity` / `1e309` / `NaN` / `1$2` / `1 2` / `100%`（field policy 外） / `1,2,3` / `2,50,0` / `1.000,5` は `NaN`、`-0` は `0` に正規化。
  - `NumericParseOptions.allowedSuffixes` を追加。suffix は大文字小文字を無視して末尾に 1 回だけ一致し、最長一致を優先（`米ドル` > `ドル`）。`deserializePortfolioFromCsv` は株数に `株`、取得単価に `円`/`JPY`/`ドル`/`USD`/`米ドル` を渡す。汎用呼び出しは従来どおり厳格。
  - `deserializePortfolioFromCsv` は `shares <= 0` または `averageCost <= 0`（欠損・非有限・負値・0 を含む）の行をスキップ。`100` / `1000` の補完を削除し、スキップ行番号を `error` で通知。
  - UI は成功時にも `res.error` があれば `warning()` toast を表示し、何行がなぜ落ちたかを可視化。成功 toast と併存する（有効行は取り込まれ、警告は別に残る）。
  - 既存の `goalComprehensiveCodeReviewFinalAudit.test.ts` は「0 cost → 1000」という捏造を固定していたため、「0 cost 行はスキップし、有効行だけ永続化」へ期待値を修正（アサーションの削除・緩和ではない）。
  - 検証: `src/lib/portfolioCsvValidation.test.ts` 10 件（NaN/Infinity/負値/欠損/0/前方一致/overflow/全行不正/列欠落に加え、単位ポリシー・単位付き行の import・境界値 round-trip・G-4 の桁区切り/通貨位置/符号・basket の `%` 後置）。`src/components/portfolioCsvImportToast.test.tsx` 5 件（mixed 行の `.toast-warning` と行番号、all-valid 行で警告なし、G-5 の same-file、race、unmount 後 handler 不進入）。round-trip は `1, 0.1, 0.30000000000000004, 1e-7, Number.EPSILON, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 1e21, Number.MAX_VALUE` に、指数 `-12..12` × 係数 `1 / 2.5 / 9.75` の決定論的 sweep を加え、実際の export（UTF-8 BOM 付き）→ import で厳密比較。
  - **fail-before**: 単位オプション導入前は `100株`/`2,500円` 行が skip され、UI は `warning` ではなく `info` だったため新テストが fail する。G-4 の `1$2` / `1,2,3` / `1.000,5` は旧実装が有限値に変換していたため、新テストは fail-before を実測済み。`-¥5,000` は旧実装が受理していたため、符号前後両対応の回帰テストを追加した。G-5 の same-file テストは即時クリア前、race/unmount テストは owner/sequence 導入前の実装で fail する。round-trip 自体は旧実装でも成立していたため、これは「境界値の回帰防止」として追加。
  - 検証: §0.3 の最終ゲートを参照。

---

## 3. 横断展開の候補（Phase 2 で対象に組み込む観点）

| 根本原因クラス | 展開先 |
|---|---|
| 「合成値に provenance が無い」（N-1/N-2/N-3） | ニュース（両経路）・マクロ指標値・FOMC レート・フォールバック決算（来歴あり・正例）・`getTickerBasePrice` 系デモ生成（`isDemoData` あり・正例）を突合し、来歴フィールドの有無を型レベルで統一する |
| 「runner 対象外テスト」（N-4） | `scripts/*.test.mjs` の将来配置も含めた照合ゲート（CI）化。`node:test` 由来のテストが他に無いか全件確認済み（本 1 件のみ） |
| 「暗号的用途での非一様写像」（N-5） | `safeRandomId`（`getRandomValues` 直用・バイアス無し・正例）、`generateOwnerToken`（同・正例）と規律を揃える |
| 「単一ソース化された契約からの地元実装」（N-6） | `readJsonBody` / `extractApiErrorMessage` の使用箇所を全件 grep し、`JSON.parse(await res.text())` 系の残存経路を一本化 |
| 「外部 provider の数値契約を捨てる」（N-9/N-10） | biquote/MQL5 の `unit` / `multiplier` / `digits` / `actual` / `revisedPrevious` を `MacroCalendarApiItem` に明示。他の外部 API（Yahoo quote / quoteSummary、macroSchedule）は型付き読み取りか静的データで、同じ「単位無視」は grep で他に無し |
| 「不正な数値を既定値で補う」（N-11） | `parseNumericValue` の全利用経路（portfolio CSV / basket CSV）を確認。portfolio は行スキップ＋field-aware な単位 suffix（株 / 円・JPY・ドル・USD・米ドル）、basket は既存の「重み1 + 警告」仕様を維持しつつ厳格な数値文法と Infinity 遮断を共有 |
| 「メタテスト」（N-7） | S6 残量（実測 87 ファイル / 1,221 ピン。§0.2 のとおり独立ロットへ deferred）の振る舞い転換 |

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
5. **N-9**（provider 契約）: 2026-11-01 に修正済み。provider 契約は `worker/macroCalendarProvider.ts` に抽出され、直接テストされる。N-1〜N-10 の機能欠陥はすべて fixed。
6. **N-11**（CSV 数値境界）/ **N-10**（改定後前回値）: 2026-11-01 に修正済み。残る機能修正は **N-7**（メタテスト残量）のみ。S7（構造分割）と S8（公開同期の abuse）は引き続き deferred で、機能修正とは独立に判断する。

各修正には「エッジケース・異常系・回帰防止」テスト（該当箇所の fail-before / pass-after 実測）を添えること。
型の弱体化・エラー抑制・テストスキップ・アサーション緩和は行わない（本リスト作成時も 0 件）。
