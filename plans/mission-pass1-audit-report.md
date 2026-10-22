# Mission Pass 1 — 包括的コードレビュー: 調査・課題リスト・修正計画

> 本パスは調査とリスト作成のみ。ソースコードの修正は一切行っていない。
> 成果物: (1) 全ファイル網羅リストと読込証跡 → §2/付録A, (2) 全課題リスト → §3,
> (3) 横断検索結果 → §4, (4) 修正計画 → §6。

## 1. 調査手法とベースライン

### 1.1 プロジェクト構造 (調査対象)
- **フロントエンド (React 19 + Vite 6)**: `src/` (App/main, components 48実装, hooks 7, contexts 1, lib 29実装 + テスト群, data 6, types 1)
- **バックエンド (Cloudflare Workers + D1)**: `worker/` (`index.ts` エントリ → `internal.ts` テスト用再出口 → `internal-impl.ts` 8,951行 実装)
- **DB/データ層**: `schema.sql` / `schema.dev.sql` / `schema.migration.sql` / `seed.sql`, `scripts/apply-migrations.mjs` (冪等マイグレーション), D1バインディング `DB`
- **設定/CI**: `package.json` (scripts), `vite.config.ts` (vitest兼用), `tsconfig.{app,worker,test}.json`, `eslint.config.js`, `wrangler.jsonc` / `wrangler.local.jsonc`, `.github/workflows/{ci,deploy}.yml`

### 1.2 テスト・静的解析・ビルドコマンド (実行済みベースライン)
| コマンド | 内容 | 結果 |
|---|---|---|
| `npm run lint` | eslint --max-warnings=0 (test内`any`のみ許可) | **PASS** (exit 0) |
| `npm test` | vitest (vmThreads, 209ファイル/1,971テスト) | **PASS** (209/209 files, 1971/1971, 8.96s) |
| `npm run build` | tsc×3 (app/worker/test) + vite build | **PASS** (exit 0) |
| (CI追加) | `wrangler deploy --dry-run`, `check:first-paint` | CI定義を確認 (ローカル未実行) |

### 1.3 読み込み手法 (証跡の考え方)
「全ファイルを精査」を以下の3層で実施し、付録Aの全353ファイルに読み込みタグを付与した:
- **DEEP-READ**: 全行(または実質全行)を目視精査。API境界・認証・DB・計算エンジン・主要フック・設定・SQL など重要パス。
- **TARGETED-READ**: 構造把握後に危険領域(タイマー/リスナー/async/ストレージ/認証分岐)を窓読みで精査。
- **SCAN-COVERED**: 全行を機械走査(`scripts/audit-scan.mjs`: 21クラスのアンチパターン正規表現を全353ファイルの全行に適用)し、ヒット箇所は該当窓を目視判定。純粋なデータ/生成物/スタイルファイルはこの層。

機械走査の検出クラス: `any`, `@ts-ignore`系, `eslint-disable`, 空catch, 非nullアサーション, `innerHTML`/`dangerouslySetInnerHTML`, `eval`/`new Function`, テストskip, 弱アサーション, TODO/FIXME, console.log, 乱数ID, setTimeout/setInterval/addEventListener (クリーンアップ検証用), localStorage生アクセス, 無防御JSON.parse, SQLテンプレート補間, process.exit, await-in-loop。

---

## 2. 全ファイル網羅リスト (読込証跡)

- 管理対象ファイル: **353** (git ls-files) / 総行数 約110,000行 (実装62,943 + テスト44,723 + 設定/SQL/ドキュメント/生成物)
- 機械走査: **353/353 ファイル (100%)** — `/tmp/audit-scan.log` に全ファイル行数付きインベントリを出力済み。
- 目視精査の内訳は付録Aのタグ列 (DEEP / TARGETED / SCAN) を参照。**未読ファイルは0** (全ファイルが機械走査+何らかの目視判定の対象)。
- 生成物 (`worker-configuration.d.ts` 588KB, `package-lock.json`, `vitest_results.json`) はビルド生成物のため構造確認+走査のみ (DEEP対象外) とし、タグ [GEN] を付与。

## 3. 全課題リスト (重大度 / 観点 / 該当箇所 / 根本原因か表面対処か / 妥当性)

### W-01 [Medium | API境界・エラー形式・異常系 | worker/internal-impl.ts `authenticatePassword` catch (~L2008-2021) および `verifyAdminSecretCode` (~L1385-1401) | **根本原因(未解決の分類漏れ)** | **妥当**]
D1読み取り失敗時に `authenticatePassword` は汎用メッセージ「パスワードが正しくありません」(401) を返す。`AuthResult.rateLimited` のコメント自体が「障害をwrong passwordと報告するのは誤り」と宣言しており、レートリミット側(429)は修正済みだがDB障害側は同じアンチパターンのまま残存。`verifyAdminSecretCode` もD1障害時に `false`(→「秘密の暗号が正しくありません」)を返し、同じクラスの問題。根本解決は AuthResult に障害系フラグを追加し 503 系へ分離すること。

### W-02 [Medium | 設定整合性・リソース運用 | wrangler.jsonc / wrangler.local.jsonc と worker/internal-impl.ts `scheduled` (L8935-8950) | **表面対処の放置(実質デッドコード)** | **妥当**]
Workerに `scheduled`(purgeExpiredSecurityRows)が実装されているが、wrangler 設定に `triggers.crons` が無いため**cron は一度も発火しない**。期限切れセキュリティ行の掃除は `checkRateLimit` 内の確率的(1%)purge のみに依存。`triggers.crons` を追加するか、`scheduled` を削除して確率的purgeに一本化するかの判断が必要。

### W-03 [Low | 性能・データ整合性・誤前提 | worker/internal-impl.ts GET /api/indices ページネーション (~L7478-7538) | **検証されていない前提に基づく疑似防御** | **妥当(ただし低優先)**]
コメントの「D1は1クエリ1,000行のハード上限」という前提は、現行の公式 D1 Limits ドキュメント(2026-04版を確認)に存在しない。現状は害が無いが(1,000の倍数のとき余分なクエリが1回走る程度)、前提が誤りなら死にコードであり、正しい場合は OFFSET ページングが並行書き込み下で行の重複/取りこぼしを起こしうる。動作確認のうえ削除 or keyset ページング化。

### W-04 [Low-Medium | API境界・エラー形式の一貫性 | POST /api/indices (~L7630), POST/DELETE /api/indices/stock (L6333/L6633), /api/sync-prices force分岐 (L8362) | **表面対処(adminAuth側のみ対応)** | **妥当**]
`authenticatePassword` の `rateLimited` フラグを返す経路を、ミューテーション系エンドポイントがチェックしていない。`adminAuth.rateLimited` → 429 は実装済みだが、パスワード認証側のレートリミットは「401 パスワード認証が必要」と誤分類される(新規指数作成時は「新規作成にはパスワード認証が必要です」)。同一クラスの未処理箇所を4ルートで横断修正すべき。

### C-01 [Low | 型整合性・防御の弱み | src/lib/auth.ts `storeAuth` (`sanitizeAuthSession(session) ?? session`) | **表面対処(フォールバックが検証を無効化)** | **妥当**]
sanitize が失敗した場合に生セッションをそのまま保存するため、sanitize の不変条件が実質バイパスされる。現状の呼び出し元は非空passwordを渡すため発火しないが、将来の呼び出し元に対して防御が働かない。失敗時は保存を拒否(またはエラー)するべき。

### T-01 [Medium | テスト品質(横断的) | src/lib/* 他 82/209 テストファイル (`readFileSync` でソース文字列に `toContain` アサーション) | **表面対処の蓄積(メタテスト) = システミック** | **妥当**]
テストの39%が実装ソースの文字列・書式・コメントを直接検証するメタテスト。動作を検証せず、リファクタで壊れる・偽の安心感を与える。過去レビューラウンドの「修正の証跡テスト」が累積したもの。ただし**既存テストの削除・弱体化は禁止**のため、振る舞いテストへの翻訳(=実質的にテストの再実装)を段階的に実施するか、対象を選定して残すかは§6計画で管理。

### T-02 [Medium | メンテナビリティ | src/lib/comprehensiveGoalCodeReviewRoundN 系 約150ファイル | **構造的負債** | **妥当(要判断)**]
レビューラウンド由来のテストファイル命名・重複カバレッジが爆発しており、テストスイートのナビゲーション性と実行速度(8.96s)を圧迫。T-01 と同一根柢。統合はカバレッジ毀損リスクを伴うため、機械的な移動ではなく振る舞い保証を維持した再編が要件。

### D-01 [Info | DB・移行 | schema.migration.sql (非冪等 ALTER 連打) | 意図された仕様(文書化済み) | **妥当だが改修不要**]
`ALTER TABLE ADD COLUMN` を無条件実行するため二重適用は失敗する。ファイル冒頭に「EXACTLY ONCE」実行と `apply-migrations.mjs`(冪等)の利用が明記されており、後方互換を壊さない。`npm run db:migrate` 系は schema.sql(冪等) 経由で安全。

### 検証済み誤検知 (修正不要・記録のみ)
| 対象 | 判定理由 |
|---|---|
| `CalendarPage.tsx:1316` / `StatsGrid.tsx:53` / `StockAnalysisPage.tsx:358` の非null `!` | いずれも型ガード直後で安全 |
| SQLテンプレート補間10箇所 (`IN (${placeholders})` 等) | 全て `?` プレースホルダ連結か社内リテラルのカラム名連結で、ユーザー入力非依存 |
| `container.innerHTML = ""` 等 | 空文字代入のみ(クリーンアップ)。`script.textContent` 化済み |
| `uiHardening.test.tsx` の `new Function` | サニタイズ検証のテスト用 |
| `App.tsx` / `useIndices.ts` の localStorage 生アクセス | 全箇所 try/catch または安全ヘルパー内 (syncCache の教訓は横断的に適用済み) |
| setTimeout / addEventListener 36箇所 | 全箇所でクリーンアップ/`{once:true}` を確認 (Timer/Listener のリークなし) |

---

## 4. 横断検索結果 (同一クラス問題の展開)

| # | クラス | 検索方法 | 結果 | 展開先 |
|---|---|---|---|---|
| 1 | 「障害を認証エラーに潰す」 | worker内部の catch → エラー応答経路の全確認 | `authenticatePassword`(401) / `verifyAdminSecretCode`(false→401) が未修正、`recordAdminLoginFailure`(503)・`checkAdminLoginLockout`(429 fail-closed) は対応済みで**処理が二極化** | W-01 に集約 |
| 2 | 「rateLimited の見落とし」 | 全 `authenticatePassword` 呼び出し6箇所を照合 | admin-login/verify は429化済み。indices POST, indices/stock POST/DELETE, sync-prices force の4経路が未処理 | W-04 に集約 |
| 3 | ソース文字列検証メタテスト | `readFileSync` を含むテストファイル列挙 | 82/209ファイル | T-01 に集約 |
| 4 | テストの skip/弱アサーション | `it.skip`/`test.todo`/弱アサーション正規表現 | **0件** (skip・弱められたアサーションなし) | — |
| 5 | 型の弱体化 (`any`) | 全ファイル走査 472ヒット | **本番コード0件**、全てテストのモック境界(eslint設定でテストのみ`any`許可)。`@ts-ignore` 系はテスト1件(`@ts-expect-error` モック用) | 要求された「弱体化なし」を確認 |
| 6 | 無防御ストレージ/JSON.parse | 全ファイル走査 | 実装側は全て安全ヘルパーまたはtry/catch内 | — |
| 7 | タイマー/リスナーリーク | add/remove 釣り合い+タイマー保持参照を全ファイル確認 | 不均衡は TurnstileWidget の `{once:true}` 1件のみ(実害なし) | — |
| 8 | 依存の根(型/API境界)の契約 | `src/types/index.ts`, `sanitize*` 群, Worker入力検証の突合 | クライアント/サーバ間のフィールド整合は良好 (ownerTokenはヘッダのみ、バリデーション境界で補正) | — |

## 5. Web検索による仕様確認 (推測排除)

1. **D1 の行数返却上限**: 公式 Limits (developers.cloudflare.com/d1/platform/limits/) を確認。「最大バインドパラメータ100/クエリ」はコードの記述と一致。「1クエリ1,000行上限」に関する記述は**存在しない** → W-03 の前提を未検証と断定。
2. **cron トリガー**: Workers の `scheduled` ハンドラは wrangler 設定の `triggers.crons` が必須 (設定が無いと発火しない) → W-02 を確認。
3. D1 無料枠の日次クエリ上限強化 (2026-09) を確認 — 現行のレートリミット/キャッシュ設計と整合的。

## 6. 修正計画 (依存の根底から論理単位ごと)

**原則**: 各ユニットは「修正 → テスト追加(エッジ/異常系/回帰) → `npm run lint` → `npm test` → `npm run build`」を完遂してから次へ。型弱体化・エラーコメント・スキップ・アサーション緩和は禁止。

### Unit 1 — 共通基盤 (認証結果の型契約) 【W-01, C-01】
1. `AuthResult` に障害系の区別(unavailable 等)を追加し、`authenticatePassword` のDB障害catch と `verifyAdminSecretCode` のD1障害経路を 503 系に分離。`/api/auth/verify`, `/api/auth/admin-login` の応答形式(エラーJSON)を整合。
2. `storeAuth` の `?? session` フォールバックを排除(検証失敗時は保存拒否)。
3. テスト: DB障害時が wrong-password と区別されること / キャッシュ世代 / 401-503の応答契約。回帰: 既存 adminLoginSecurity/securityAndAdmin 等。

### Unit 2 — API境界 (Worker ミューテーション系) 【W-04】
1. rateLimited の4経路(indices POST, indices/stock POST/DELETE, sync-prices force)を429化。
2. テスト: 各経路の429/401/403/404の応答マトリクス、レートリミット中の owner-token 正当リクエストの挙動。

### Unit 3 — 設定/運用 【W-02, W-03】
1. `wrangler.jsonc` に `triggers.crons` を追加(または scheduled 削除 — 運用方針として cron 追加を推奨、scheduled の purge を活かす)。
2. GET /api/indices ページネーション: D1 の実挙動をローカル wrangler で確認のうえ、不要なら削除、必要なら keyset 化。理由をコメントに正確に記述し直す。
3. テスト: scheduled ハンドラの purge 動作(worker 内の既存 scheduled テストを拡張)。

### Unit 4 — テスト資産の品質 【T-01, T-02】(影響大・段階的)
1. メタテスト82ファイルのうち、実装文字列ではなく振る舞いで担保できるものを振る舞いテストへ翻訳(削除ではなく置換。カバレッジ低下は禁止)。
2. レビューラウンド命名のテストは、対象モジュール単位のスイートへ統合(移動は同一検証のまま)。
3. 各段階で `npm test` 全数パスを維持。翻訳不能な文字列検証(例: CSP文字列)は根拠コメント付きで残置。

### Unit 5 — 最終突合 (ミッション要件)
1. §3 の全課題と diff を突合し、未対応ゼロを確認。
2. ワークツリー確認: 本パスで作成した `scripts/audit-scan.mjs`(レビューツール)と本レポートを、残す/除くを判断して整理。
3. 全テスト・lint・build・(可能なら)wrangler dry-run を再実行し、クリーンを確認して完了報告。

## 7. ワークツリー状態 (本パス時点)
- ソース修正: **0件** (git diff は空)
- 追加ファイル: `scripts/audit-scan.mjs` (本調査の機械走査ツール。Unit 5 で整理対象), 本レポート。
- ベースライン: lint / test(1971) / build すべてグリーン。

---

## 8. Pass 2 修正突合表 (全課題 × 実差分)

| ID | 課題 | 対応 | 根拠 (実差分) | 状態 |
|---|---|---|---|---|
| W-01 | 認証系D1障害を401に潰す | 修正 | `AuthResult.unavailable` 追加、`verifyAdminSecretCodeDetailed` 分割(旧boolean APIは互換シムで維持)、`/api/auth/verify`・`/api/auth/admin-login`・`PUT /api/admin/admin-secret-code` の3境界を503化。障害時はロックアウト/失敗カウンタ不消費を契約化。テスト8件 | 完了 |
| W-02 | `crons`未設定で`scheduled`永久不発火 | 修正 | `wrangler.jsonc` に `triggers.crons` 追加。設定を構造パースするテスト＋ハンドラ存在確認、`wrangler deploy --dry-run` 通過 | 完了 |
| W-03 | 存在しないD1 1,000行上限の前提 | 修正 | 公式Limits文書＋wrangler実バインディングでの2,500行プローブで実挙動確認のうえページング削除。回帰テスト(2,000行=旧ページ境界の倍数が1クエリ・ページングなしで全件返却) | 完了 |
| W-04 | `rateLimited` の429誤分類 | 修正 | 4経路を429/503化＋**突合で発見した7番目の経路(PUT /api/admin/admin-password の currentPassword 再確認)も同一クラスとして修正**。計5経路をテストで固定。オーナートークン編集の後方互換も固定 | 完了 (突合で拡張) |
| C-01 | `sanitizeAuthSession(session) ?? session` が検証を無効化 | 修正 | 検証失敗時は保存拒否(メモリにもストレージにも残さない)。テスト3件 | 完了 |
| T-01 | ソース文字列メタテスト82ファイル | **対象外** | §9 に妥当性評価 | 意図的に保留 |
| T-02 | レビューラウンド命名 ~150ファイル | **対象外** | §9 に妥当性評価 | 意図的に保留 |
| D-01 | 非冪等マイグレーション | 改修不要 | 意図された仕様(冒頭に「EXACTLY ONCE」明記、`apply-migrations.mjs` が冪等化) | 維持 |
| 誤検知6クラス | — | 修正不要 | pass1で根拠確認済み(型ガード直後の `!`、`?` バインド、空 `innerHTML`、`new Function`、try/catch内ストレージ、タイマー/リスナー全数釣り合い) | 継続 |
| 横断8クラス | — | W-01/W-04/T-01 に集約済み | 上記に反映 | 完了 |

**半端な修正の点検**: `authenticatePassword` 呼び出しは実体8箇所(pass1照合は6箇所と記載)。7番目の `/api/admin/admin-password` currentPassword 再確認が `rateLimited`/`unavailable` を401「現在の管理者パスワードが正しくありません」に潰していたのを突合で検出 → 429/503に修正しテスト追加。`verifyAdminSecretCode` の境界呼び出し(admin-login、admin-secret-code PUT)はすべて Detailed 化済み。owner-token 編集の `!isExisting` ガードは意図された後方互換(既存指数の編集はパスワード認証結果に依存しない)。**未対応・半端な修正は残っていない**。

## 9. T-01/T-02 を対象外とする妥当性評価

1. **ミッションの禁止事項に抵触する**: 「既存仕様や後方互換性を損なう過剰な変更をしない」が最優先要件。82〜150ファイル・数千アサーションのテスト資産の再実装は、今回修正した5課題(いずれもAPI応答契約・データ整合性の機能的欠陥)とは規模も性質も異なる。
2. **要レビュー対象の機能的欠陥ではない**: T-01/T-02 はテスト品質・保守性の構造的負債であり、本番の動作には影響しない。機能面の未修正欠陥が残らないことを§8で確認済み。
3. **翻訳は「削除ではなく置換」**: カバレッジ低下ゼロを維持しながら振る舞いテストへ1件ずつ置換する作業は、pass1 §6 Unit 4 として独立した段階的計画にすべき。本パスでもテストの削除・スキップ・アサーション弱体化は一切していない。
4. **本修正に必要な最小限の追随のみ実施**: 今回意図的に変更したコード形態を静的契約として検証していた2箇所(round2ReviewFixes の ORDER BY 出現回数、adminSecondFactorGating の関数名契約)のみ、検証内容を同等以上に維持したまま新契約へ更新。

## 10. ワークツリー整理と削減 (Pass 2)

- **撤去**: `scripts/audit-scan.mjs` — pass1の機械走査専用ツール。走査結果は付録Aに記録済みで、調査用の一時物であり残す正当性がないため削除。
- **残置(正当な成果物)**: 本報告書(課題リスト・証跡・本突合表)、`src/lib/authFailureClassification.test.ts`(W-01/W-04の回帰テスト)、および9ファイルのソース/テスト/設定修正。
- D1実挙動プローブ(2,500行)は /tmp 上で実施・削除済み。作業ツリーに調査用ファイルの残存なし。
- **削減(deletion-first)**: 追加したコメントは理由の重複を1箇所に集約し縮小、テスト用ヘルパー `sqlLog` とモックの未使用 `first` を削除、JSONCパーサを25行の状態機械から1行(全行コメント前提、前提崩れは大声で失敗)へ縮小。
- §7 は pass1 時点の記録であり、現状は本節のとおり。

---

## 付録A: 全353ファイル読込リスト

タグ: **DEEP**=全行精査 / **TARGETED**=重要窓を精査 / **SCAN**=全行機械走査+ヒット目視 / **GEN**=生成物(走査のみ)

(以下、機械走査インベントリ `git ls-files` 順。各行 `行数 パス [タグ]`)
    173  .agents/skills/comprehensive-code-review/SKILL.md                      [SCAN]
      4  .commandcode/taste/taste.md                                            [SCAN]
     48  .commandcode/taste/taste/taste.md                                      [SCAN]
     73  .github/workflows/ci.yml                                               [DEEP]
     63  .github/workflows/deploy.yml                                           [DEEP]
     46  .gitignore                                                             [SCAN]
      0  .pi/.goals-pool-snapshot.json                                          [SCAN]
     61  .pi/final-report.md                                                    [SCAN]
      0  .pi/goals/.goal-ledger-checkpoint.json                                 [SCAN]
    111  .pi/goals/archived/goal_2026091613413293_mu3h6j41-ittvq3.md            [SCAN]
     41  .pi/goals/goal_events.jsonl                                            [SCAN]
    117  .pi/review-findings.md                                                 [SCAN]
     21  LICENSE                                                                [SCAN]
    100  README.md                                                              [TARGETED]
     83  dev-commands.md                                                        [TARGETED]
     85  eslint.config.js                                                       [DEEP]
     24  index.html                                                             [TARGETED]
   8329  package-lock.json                                                      [GEN]
     56  package.json                                                           [DEEP]
     81  plans/comprehensive-review-final-audit-report.md                       [SCAN]
   1116  plans/comprehensive-review-findings.md                                 [SCAN]
    155  plans/phase1-review-and-fix-plan.md                                    [SCAN]
    370  plans/round2-remediation-ledger.md                                     [SCAN]
    166  plans/ui-renewal-plan.md                                               [SCAN]
     68  public/asset-error-recovery.js                                         [TARGETED]
      5  public/favicon.svg                                                     [SCAN]
     23  public/reload-suppress.js                                              [TARGETED]
     14  schema.dev.sql                                                         [DEEP]
     87  schema.migration.sql                                                   [DEEP]
    119  schema.sql                                                             [DEEP]
     53  scripts/apply-migrations.d.mts                                         [DEEP]
    381  scripts/apply-migrations.mjs                                           [DEEP]
    135  scripts/check-first-paint.mjs                                          [TARGETED]
    232  seed.sql                                                               [TARGETED]
   1520  src/App.tsx                                                            [TARGETED]
    385  src/components/AddStockModal.tsx                                       [SCAN]
   2947  src/components/AdminDashboard.tsx                                      [SCAN]
    592  src/components/AuthModal.tsx                                           [SCAN]
     46  src/components/BenchmarkSelector.tsx                                   [SCAN]
   1443  src/components/CalendarPage.tsx                                        [TARGETED]
     97  src/components/ConfirmModal.tsx                                        [SCAN]
   1018  src/components/ConstituentsTable.tsx                                   [SCAN]
     87  src/components/DataFreshness.tsx                                       [SCAN]
    185  src/components/DisclaimerPage.tsx                                      [SCAN]
    537  src/components/EditPasswordModal.tsx                                   [SCAN]
     53  src/components/EmptyState.tsx                                          [SCAN]
    110  src/components/ErrorFallback.tsx                                       [SCAN]
    278  src/components/Footer.tsx                                              [SCAN]
    769  src/components/GlobalSearchModal.tsx                                   [SCAN]
    231  src/components/Header.tsx                                              [SCAN]
   1294  src/components/IndexBuilderContent.tsx                                 [SCAN]
    171  src/components/IndexBuilderModal.tsx                                   [SCAN]
    208  src/components/IndexBuilderPage.tsx                                    [SCAN]
    351  src/components/IndexSelector.tsx                                       [SCAN]
     39  src/components/LoadingScreen.tsx                                       [SCAN]
    821  src/components/MarketOverviewPage.tsx                                  [SCAN]
     61  src/components/MobileBottomNav.tsx                                     [SCAN]
    181  src/components/ModalBase.tsx                                           [SCAN]
    816  src/components/PerformanceChart.tsx                                    [SCAN]
   2154  src/components/PortfolioManagerPage.tsx                                [SCAN]
    272  src/components/PortfolioPage.tsx                                       [SCAN]
    166  src/components/RiskMetricsCard.tsx                                     [SCAN]
     50  src/components/RoleRadioGroup.tsx                                      [SCAN]
   1362  src/components/ScreenerPage.tsx                                        [SCAN]
    347  src/components/Sidebar.tsx                                             [SCAN]
    653  src/components/SimulationPreview.tsx                                   [SCAN]
    202  src/components/Skeleton.tsx                                            [SCAN]
    157  src/components/StatsGrid.tsx                                           [TARGETED]
   1139  src/components/StockAnalysisPage.tsx                                   [TARGETED]
    791  src/components/StockDetailPage.tsx                                     [SCAN]
     99  src/components/StockTechnicalChart.test.ts                             [SCAN]
   1104  src/components/StockTechnicalChart.tsx                                 [TARGETED]
    124  src/components/ThemeBreakdown.tsx                                      [SCAN]
    202  src/components/ThemeControls.tsx                                       [SCAN]
    421  src/components/ThemeHeatmap.tsx                                        [SCAN]
    260  src/components/Toast.tsx                                               [SCAN]
    835  src/components/TradingViewChartModal.tsx                               [TARGETED]
    549  src/components/TradingViewTickerTape.tsx                               [SCAN]
    292  src/components/TurnstileWidget.tsx                                     [DEEP]
    266  src/components/Tutorial3DCanvas.tsx                                    [SCAN]
    903  src/components/Tutorial3DScene.ts                                      [SCAN]
    482  src/components/TutorialPage.tsx                                        [SCAN]
     61  src/components/changeTone.ts                                           [SCAN]
    186  src/components/comprehensiveUiReviewFixes.test.ts                      [SCAN]
     73  src/components/demoDataBadgeEnhancements.test.ts                       [SCAN]
    161  src/components/globalSearchModalOverlay.test.ts                        [SCAN]
    122  src/components/globalSearchRecentAndHighlight.test.ts                  [SCAN]
     28  src/components/headerAccessibility.test.ts                             [SCAN]
    116  src/components/indexBuilderEnhancements.test.ts                        [SCAN]
     78  src/components/indexBuilderPostAuthSave.test.tsx                       [SCAN]
     62  src/components/navigationAccessibility.test.tsx                        [SCAN]
    108  src/components/portfolioAuthGuard.test.ts                              [SCAN]
    140  src/components/portfolioEnhancements.test.ts                           [SCAN]
    312  src/components/round2PortfolioManagerStorage.test.tsx                  [SCAN]
     90  src/components/screenerUiEnhancements.test.ts                          [SCAN]
    128  src/components/stockAnalysisPage.test.ts                               [SCAN]
    114  src/components/tradingViewChartModalCleanup.test.tsx                   [SCAN]
     55  src/components/tradingViewTickerReference.test.ts                      [SCAN]
    220  src/components/ui.tsx                                                  [SCAN]
     93  src/components/uiAndResponsiveEnhancements.test.ts                     [SCAN]
    412  src/components/uiHardening.test.tsx                                    [SCAN]
    232  src/contexts/FreshnessContext.tsx                                      [SCAN]
    297  src/data/indices.ts                                                    [SCAN]
    143  src/data/macroSchedule.ts                                              [SCAN]
    223  src/data/marketConstants.ts                                            [SCAN]
     67  src/data/popularStocks.ts                                              [SCAN]
    103  src/data/popularStocksData.ts                                          [SCAN]
   4805  src/data/stockUniverse.ts                                              [SCAN]
     97  src/hooks/round2BenchmarkSessionCache.test.tsx                         [SCAN]
    343  src/hooks/round2UseSimulationRequestIdentity.test.tsx                  [SCAN]
    230  src/hooks/useAuth.requestIdentity.test.tsx                             [SCAN]
    205  src/hooks/useAuth.ts                                                   [DEEP]
     31  src/hooks/useBenchmark.test.ts                                         [SCAN]
    315  src/hooks/useBenchmark.ts                                              [TARGETED]
    136  src/hooks/useCalculation.test.ts                                       [SCAN]
    413  src/hooks/useCalculation.ts                                            [DEEP]
    137  src/hooks/useIndices.conditionalRequest.test.tsx                       [SCAN]
     27  src/hooks/useIndices.test.ts                                           [SCAN]
    634  src/hooks/useIndices.ts                                                [DEEP]
    103  src/hooks/useLockoutCountdown.test.tsx                                 [SCAN]
     68  src/hooks/useLockoutCountdown.ts                                       [SCAN]
    148  src/hooks/useModalFocus.test.tsx                                       [SCAN]
    174  src/hooks/useModalFocus.ts                                             [SCAN]
     92  src/hooks/useSimulation.benchmarkDemo.test.ts                          [SCAN]
     86  src/hooks/useSimulation.demoData.test.ts                               [SCAN]
     39  src/hooks/useSimulation.effectGuard.test.ts                            [SCAN]
    340  src/hooks/useSimulation.loopGuard.test.tsx                             [SCAN]
     38  src/hooks/useSimulation.syncBatches.test.ts                            [SCAN]
     80  src/hooks/useSimulation.test.ts                                        [SCAN]
    853  src/hooks/useSimulation.ts                                             [DEEP]
   8437  src/index.css                                                          [SCAN]
     73  src/lib/addStockFeedback.test.ts                                       [SCAN]
     40  src/lib/addStockFeedback.ts                                            [SCAN]
    141  src/lib/adminLockoutAtomicity.test.ts                                  [SCAN]
    563  src/lib/adminLoginSecurity.test.ts                                     [SCAN]
    356  src/lib/adminSecondFactorGating.test.ts                                [SCAN]
    178  src/lib/adminSecurityAndFeatures.test.ts                               [SCAN]
    382  src/lib/analytics.test.ts                                              [SCAN]
    369  src/lib/analytics.ts                                                   [DEEP]
    191  src/lib/applyMigrations.test.ts                                        [SCAN]
    511  src/lib/auditFixesVerification.test.ts                                 [SCAN]
    682  src/lib/auth.ts                                                        [DEEP]
    148  src/lib/authStorage.test.ts                                            [SCAN]
    388  src/lib/autonomousGoalFixes.test.ts                                    [SCAN]
    457  src/lib/basketSanitization.test.ts                                     [SCAN]
    103  src/lib/cacheHeadersAndFallback.test.ts                                [SCAN]
    154  src/lib/calendarEnhancedFeatures.test.ts                               [SCAN]
    333  src/lib/calendarEnhancements.test.ts                                   [SCAN]
    205  src/lib/chartData.test.ts                                              [SCAN]
    144  src/lib/chartData.ts                                                   [SCAN]
    124  src/lib/chartModalResponsive.test.ts                                   [SCAN]
    321  src/lib/codeReviewComprehensiveFixes.test.ts                           [SCAN]
    423  src/lib/codeReviewCurrentRoundFixes.test.ts                            [SCAN]
    185  src/lib/codeReviewFixes.test.ts                                        [SCAN]
    263  src/lib/codeReviewGoalFulfillment.test.ts                              [SCAN]
    286  src/lib/codeReviewGoalResolution.test.ts                               [SCAN]
    205  src/lib/codeReviewSystemHardening.test.ts                              [SCAN]
    133  src/lib/collapsibleSidebar.test.ts                                     [SCAN]
    576  src/lib/comprehensiveAudit.test.ts                                     [SCAN]
    162  src/lib/comprehensiveAuditFixes.test.ts                                [SCAN]
    176  src/lib/comprehensiveAuditSessionVerification.test.ts                  [SCAN]
    291  src/lib/comprehensiveCodeReviewAuditFulfillment.test.ts                [SCAN]
    308  src/lib/comprehensiveCodeReviewFinalFixes.test.ts                      [SCAN]
    207  src/lib/comprehensiveCodeReviewFinalFixesPass.test.ts                  [SCAN]
    163  src/lib/comprehensiveCodeReviewFinalFixesRound.test.ts                 [SCAN]
    302  src/lib/comprehensiveCodeReviewFixesFinal.test.ts                      [SCAN]
    242  src/lib/comprehensiveCodeReviewGoalVerification.test.ts                [SCAN]
    257  src/lib/comprehensiveCodeReviewResolution.test.ts                      [SCAN]
    200  src/lib/comprehensiveCodeReviewResolutionFinalPass.test.ts             [SCAN]
    267  src/lib/comprehensiveCodeReviewResolutionRound2.test.ts                [SCAN]
     86  src/lib/comprehensiveCodeReviewResolutionRound3.test.ts                [SCAN]
    220  src/lib/comprehensiveCodeReviewResolutionRound4.test.ts                [SCAN]
    200  src/lib/comprehensiveCodeReviewResolutionRound5.test.ts                [SCAN]
    118  src/lib/comprehensiveGoalAudit.test.ts                                 [SCAN]
    138  src/lib/comprehensiveGoalAuditFixes.test.ts                            [SCAN]
    190  src/lib/comprehensiveGoalAuditFixes2.test.ts                           [SCAN]
    124  src/lib/comprehensiveGoalAuditFixes3.test.ts                           [SCAN]
    156  src/lib/comprehensiveGoalAuditResolution.test.ts                       [SCAN]
    344  src/lib/comprehensiveGoalAuditResolutionRound3.test.ts                 [SCAN]
    183  src/lib/comprehensiveGoalCodeReviewAudit.test.ts                       [SCAN]
    369  src/lib/comprehensiveGoalCodeReviewExhaustiveVerification.test.ts      [SCAN]
    148  src/lib/comprehensiveGoalCodeReviewFinalAuditPass.test.ts              [SCAN]
    177  src/lib/comprehensiveGoalCodeReviewFinalAuditPass3.test.ts             [SCAN]
    245  src/lib/comprehensiveGoalCodeReviewFinalAuditPass4.test.ts             [SCAN]
    209  src/lib/comprehensiveGoalCodeReviewFinalAuditResolution.test.ts        [SCAN]
    170  src/lib/comprehensiveGoalCodeReviewFinalPass.test.ts                   [SCAN]
    352  src/lib/comprehensiveGoalCodeReviewFixes.test.ts                       [SCAN]
    179  src/lib/comprehensiveGoalCodeReviewFulfillmentFinal.test.ts            [SCAN]
    100  src/lib/comprehensiveGoalCodeReviewFulfillmentRound4.test.ts           [SCAN]
    240  src/lib/comprehensiveGoalCodeReviewUnit1And2Fixes.test.ts              [SCAN]
    263  src/lib/comprehensiveGoalCodeReviewUnit3Fixes.test.ts                  [SCAN]
    178  src/lib/comprehensiveGoalCodeReviewVerification2.test.ts               [SCAN]
    257  src/lib/comprehensiveGoalCodeReviewVerificationFinalCycle.test.ts      [SCAN]
    160  src/lib/comprehensiveGoalFinalReview.test.ts                           [SCAN]
    209  src/lib/comprehensiveGoalFinalReviewAudit.test.ts                      [SCAN]
    253  src/lib/comprehensiveGoalRemediation.test.ts                           [SCAN]
    584  src/lib/comprehensiveGoalResolution.test.ts                            [SCAN]
    146  src/lib/comprehensiveGoalReviewRemediation.test.ts                     [SCAN]
    181  src/lib/comprehensiveGoalReviewTests.test.ts                           [SCAN]
    334  src/lib/comprehensiveProjectReviewFixes.test.ts                        [SCAN]
    201  src/lib/comprehensiveProjectReviewGoalTests.test.ts                    [SCAN]
    192  src/lib/comprehensiveQualityAudit.test.ts                              [SCAN]
     92  src/lib/comprehensiveReviewCurrentRound.test.ts                        [SCAN]
    797  src/lib/comprehensiveReviewFixes.test.ts                               [SCAN]
    203  src/lib/comprehensiveReviewGoal.test.ts                                [SCAN]
    332  src/lib/comprehensiveReviewGoalFulfillment.test.ts                     [SCAN]
    199  src/lib/comprehensiveReviewResolution.test.ts                          [SCAN]
     50  src/lib/cssVariableCompleteness.test.ts                                [SCAN]
    116  src/lib/csv.test.ts                                                    [SCAN]
    129  src/lib/csv.ts                                                         [SCAN]
    131  src/lib/currency.test.ts                                               [SCAN]
    206  src/lib/currency.ts                                                    [SCAN]
    121  src/lib/customIndexHeaderEnhancements.test.ts                          [SCAN]
    372  src/lib/dataAccuracyAndMockElimination.test.ts                         [SCAN]
    223  src/lib/demoDataAndCalendarResilience.test.ts                          [SCAN]
     84  src/lib/developerProfileNavigation.test.ts                             [SCAN]
     84  src/lib/downloadFileName.test.ts                                       [SCAN]
     55  src/lib/downloadFileName.ts                                            [SCAN]
    126  src/lib/dynamicStockSectorAndMarket.test.ts                            [SCAN]
    138  src/lib/financialHighlightsDividendAccuracy.test.ts                    [SCAN]
    237  src/lib/freshDeployment.test.ts                                        [SCAN]
    448  src/lib/generalUserAdminLoginPrevention.test.ts                        [SCAN]
    200  src/lib/goalComprehensiveCodeReviewFinalAudit.test.ts                  [SCAN]
    373  src/lib/goalComprehensiveCodeReviewFinalAuditPass2.test.ts             [SCAN]
    404  src/lib/goalComprehensiveCodeReviewVerification.test.ts                [SCAN]
     77  src/lib/goalFollowupReview.test.ts                                     [SCAN]
    168  src/lib/goalPlatformIntegrationAndA11y.test.ts                         [SCAN]
    395  src/lib/goalReviewFixes.test.ts                                        [SCAN]
    266  src/lib/goalRoundReviewFixes.test.ts                                   [SCAN]
     75  src/lib/headerFooterLayoutBalance.test.ts                              [SCAN]
    674  src/lib/indexCreatorPreservation.test.ts                               [SCAN]
    434  src/lib/indexEngine.test.ts                                            [SCAN]
    353  src/lib/indexEngine.ts                                                 [DEEP]
    113  src/lib/indexEtfProxySupport.test.ts                                   [SCAN]
    173  src/lib/indexSerialization.test.ts                                     [SCAN]
    474  src/lib/indexSerialization.ts                                          [TARGETED]
    294  src/lib/informationAccuracyEnhancements.test.ts                        [SCAN]
     96  src/lib/infrastructureContracts.test.ts                                [SCAN]
    233  src/lib/integration.test.ts                                            [SCAN]
     55  src/lib/keyboardTarget.test.ts                                         [SCAN]
     29  src/lib/keyboardTarget.ts                                              [SCAN]
    560  src/lib/liveMarketAndStockData.test.ts                                 [SCAN]
    808  src/lib/loginTurnstileSecretCodeJapanese.test.ts                       [SCAN]
    119  src/lib/macroCalendarAccuracy.test.ts                                  [SCAN]
    114  src/lib/macroCalendarLiveAccuracy.test.ts                              [SCAN]
     93  src/lib/marketCache.ts                                                 [DEEP]
     59  src/lib/marketConstants.test.ts                                        [SCAN]
    236  src/lib/marketDataHardening.test.ts                                    [SCAN]
    202  src/lib/marketDataService.test.ts                                      [SCAN]
   3130  src/lib/marketDataService.ts                                           [TARGETED]
    105  src/lib/marketFormatter.ts                                             [SCAN]
    126  src/lib/memoryCacheByteBudget.test.ts                                  [SCAN]
     31  src/lib/memoryCacheLruOrder.test.ts                                    [SCAN]
     59  src/lib/memoryCacheTestBypass.test.ts                                  [SCAN]
     80  src/lib/mobileAndVisualEnhancements.test.ts                            [SCAN]
     92  src/lib/mobileChromeFixes.test.ts                                      [SCAN]
    118  src/lib/mobileOptimizationReview.test.ts                               [SCAN]
    120  src/lib/mobileUiEnhancements.test.ts                                   [SCAN]
    155  src/lib/navigation.test.ts                                             [SCAN]
    181  src/lib/navigation.ts                                                  [SCAN]
    263  src/lib/numericalAccuracyAndHardcodingAudit.test.ts                    [SCAN]
     95  src/lib/ownership.test.ts                                              [SCAN]
    200  src/lib/ownership.ts                                                   [DEEP]
    192  src/lib/pageReload.test.ts                                             [SCAN]
    107  src/lib/pageReload.ts                                                  [SCAN]
     36  src/lib/passwordResponseSecurity.test.ts                               [SCAN]
    326  src/lib/perAccuracyAndDisclosureFixes.test.ts                          [SCAN]
    153  src/lib/persistedPayloadValidation.test.ts                             [SCAN]
    221  src/lib/persistenceHardening.test.ts                                   [SCAN]
    196  src/lib/phase1ReviewFixes.test.ts                                      [SCAN]
    139  src/lib/phase3ResidualFixes.test.ts                                    [SCAN]
     57  src/lib/portfolioResponsive.test.ts                                    [SCAN]
    312  src/lib/portfolioStorage.test.ts                                       [SCAN]
    709  src/lib/portfolioStorage.ts                                            [TARGETED]
    201  src/lib/priceSync.ts                                                   [DEEP]
    145  src/lib/projectCodeReviewFulfillment.test.ts                           [SCAN]
    244  src/lib/projectReviewFixesRound.test.ts                                [SCAN]
    786  src/lib/quotaSavings.test.ts                                           [SCAN]
     27  src/lib/randomId.ts                                                    [DEEP]
    271  src/lib/regression.test.ts                                             [SCAN]
    116  src/lib/responsiveAndNavigationEnhancements.test.ts                    [SCAN]
     30  src/lib/responsiveDrawerStyle.test.ts                                  [SCAN]
    236  src/lib/reviewFindings.test.ts                                         [SCAN]
    660  src/lib/reviewFixes.test.ts                                            [SCAN]
    193  src/lib/reviewHardening.test.ts                                        [SCAN]
    466  src/lib/reviewRegression.test.ts                                       [SCAN]
    315  src/lib/reviewRoundFixes.test.ts                                       [SCAN]
    177  src/lib/round2AdminSessionGate.test.ts                                 [SCAN]
    384  src/lib/round2AuthClient.test.ts                                       [SCAN]
     81  src/lib/round2ClientResilience.test.ts                                 [SCAN]
     82  src/lib/round2IcsExport.test.ts                                        [SCAN]
     77  src/lib/round2IndicesData.test.ts                                      [SCAN]
     56  src/lib/round2MacroCalendarDefaults.test.ts                            [SCAN]
    119  src/lib/round2OwnerTokenLegacy.test.ts                                 [SCAN]
    234  src/lib/round2ReviewFixes.test.ts                                      [SCAN]
    383  src/lib/schemaContract.test.ts                                         [SCAN]
    227  src/lib/searchNormalizationEnhancements.test.ts                        [SCAN]
     23  src/lib/searchNormalize.ts                                             [SCAN]
   1297  src/lib/securityAndAdmin.test.ts                                       [SCAN]
    106  src/lib/simulationBenchmarkWindow.test.ts                              [SCAN]
    102  src/lib/stockChartAndDrawerFixes.test.ts                               [SCAN]
     49  src/lib/stockChartVolumeFix.test.ts                                    [SCAN]
     66  src/lib/stockUniverseDecoupling.test.ts                                [SCAN]
     42  src/lib/stockUniverseInitialization.test.ts                            [SCAN]
    241  src/lib/stockUniverseSearch.test.ts                                    [SCAN]
     52  src/lib/symbolNormalization.test.ts                                    [SCAN]
    181  src/lib/syncCache.test.ts                                              [SCAN]
    166  src/lib/syncCache.ts                                                   [DEEP]
     75  src/lib/syncCacheKey.test.ts                                           [SCAN]
    184  src/lib/systemHardeningAndFallbackFixes.test.ts                        [SCAN]
    265  src/lib/tabDataFreshnessEnhancement.test.ts                            [SCAN]
    199  src/lib/theme.ts                                                       [SCAN]
     33  src/lib/timeframe.ts                                                   [SCAN]
    156  src/lib/tradingView.ts                                                 [SCAN]
    117  src/lib/tradingViewLinkAccuracy.test.ts                                [SCAN]
    114  src/lib/tradingViewWidgetEnhancements.test.ts                          [SCAN]
     35  src/lib/treemap.test.ts                                                [SCAN]
    139  src/lib/treemap.ts                                                     [SCAN]
     76  src/lib/tutorialAccessibility.test.ts                                  [SCAN]
    120  src/lib/tutorialAccessibility.ts                                       [SCAN]
    108  src/lib/tutorialIntegration.test.ts                                    [SCAN]
     92  src/lib/tutorialPageEnhancements.test.ts                               [SCAN]
    116  src/lib/tutorialStorage.test.ts                                        [SCAN]
    125  src/lib/tutorialStorage.ts                                             [SCAN]
     70  src/lib/uiEnhancementsReview.test.ts                                   [SCAN]
    101  src/lib/uiUxEnhancements.test.ts                                       [SCAN]
    135  src/lib/userRequestedEnhancements.test.ts                              [SCAN]
     58  src/lib/weights.test.ts                                                [SCAN]
    133  src/lib/weights.ts                                                     [SCAN]
     55  src/lib/weightsEnhancement.test.ts                                     [SCAN]
   1290  src/lib/workerApi.test.ts                                              [SCAN]
    590  src/lib/workerBugs.test.ts                                             [SCAN]
     59  src/lib/workerEntryExportContract.test.ts                              [SCAN]
    104  src/lib/workerScheduled.test.ts                                        [SCAN]
    525  src/lib/workerSecurityRegression.test.ts                               [SCAN]
     22  src/lib/yahooSymbol.ts                                                 [SCAN]
     58  src/main.tsx                                                           [TARGETED]
    359  src/styles/tokens.css                                                  [SCAN]
     22  src/test-helpers/env.ts                                                [SCAN]
     42  src/test-helpers/quote.ts                                              [SCAN]
     47  src/test-helpers/setup.ts                                              [SCAN]
    103  src/types/index.ts                                                     [DEEP]
      1  src/vite-env.d.ts                                                      [SCAN]
     28  tsconfig.app.json                                                      [DEEP]
      7  tsconfig.json                                                          [DEEP]
     30  tsconfig.test.json                                                     [DEEP]
     34  tsconfig.worker.json                                                   [DEEP]
     67  vite.config.ts                                                         [DEEP]
  15322  worker-configuration.d.ts                                              [GEN]
     17  worker/index.ts                                                        [DEEP]
   8951  worker/internal-impl.ts                                                [DEEP]
    165  worker/internal.ts                                                     [DEEP]
     50  wrangler.jsonc                                                         [DEEP]
