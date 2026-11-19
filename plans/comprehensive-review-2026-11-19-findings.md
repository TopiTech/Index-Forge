# 包括コードレビュー 2026-11-19 — 全課題リストと最終台帳

ベースライン: lint 0違反 / test 316 files・2826 tests / build PASS。
最終: test **336 files・2916 tests PASS** / lint PASS / build PASS / first-paint PASS / wrangler dry-run PASS。

レビュー範囲: 追跡済み477ファイルのうち、third-party・generated・過去レビュー文書を除く本番コード105ファイルを全文精査（worker 5 / src/lib 34 / src/hooks 7 / src/components 48 / src/data 6 / src/types 1 / src/contexts 1 / scripts 8 / public 3 / config・workflow 22）。既存テスト316ファイルは runner 対象・型検査対象として確認し、最終的に336ファイルへ増加。

## 全課題一覧（最終処置）

| ID | Area | Sev | 課題（根本原因） | 状態 |
|---|---|---|---|---|
| H1 | hooks | High | `useIndices` の mounted effect が fetch effect より後に宣言され、StrictMode 再 setup で初期フェッチがスキップされ loading が永久固着 | FIXED |
| H2 | hooks | Low | `useSimulation` recompute の `setSyncWarnings` が新配列を書く | FIXED: `sameWarnings` で内容比較し、同一内容なら前参照を返す（修正前失敗を確認済み） |
| L1 | data | Medium | `syncCache` が未来タイムスタンプを無期限 fresh として扱う | FIXED |
| L2 | data | Low | `filledCellRatio` が pre-start セルを分母に残し欠測率を過小報告 | FIXED |
| L3 | auth | Low | `verifyPassword` の返却 session だけ未サニタイズで保存値と不一致 | FIXED |
| L4 | data | Low | `safeRandomId` の Web Crypto 不在フォールバック衝突 | DISCARD: `getRandomValues` は insecure context でも利用可能（MDN）。fallback はブラウザ到達不可で、既存テストが互換性を固定 |
| L5 | data | Low | JSON import が500件超を警告なしで切り捨て | FIXED |
| L6 | data | Low | 指数/FX/暗号に `market:"US"` を付与 | FIXED |
| L7 | data | Low | フォールバックカレンダがローカル暦で JST 境界とずれ | FIXED |
| L8 | data | Low | レガシー配列カレンダキャッシュが TTL を回避 | FIXED（読み取り時に TTL 付き形式へ移行。既存の有効イベントは保持） |
| W1 | worker | Medium | カレンダの直列フォールバックに全体予算がなく最悪約40s | FIXED |
| W2 | worker | Medium | 個別銘柄の6.5s予算が crumb / SEC へ未伝播 | FIXED |
| W3 | worker | Medium | screener ライブ分岐が欠損値を price由来/固定値で捏造 | FIXED |
| W4 | worker | Medium | logout が未認証・無制限で D1 DELETE | FIXED（IP 30/min、レスポンス契約不変） |
| W5 | worker | Low | screener ライブ価格に前回の評価指標を混在 | FIXED |
| W6 | worker | Low | Turnstile 通信障害が400に分類 | FIXED（unavailable→503） |
| W7 | worker | Low | sync-prices の上限検査が正規化ループ後 | FIXED |
| P1-01 | UI/data | Medium | 参考値株価が取得単価として永続化 | FIXED |
| P1-02 | UI/state | Medium | FX のみ実データでポートフォリオ全体が LIVE | FIXED |
| P1-03 | UI/a11y | Medium | チュートリアルが Cmd/Ctrl+R を奪う | FIXED |
| P1-04 | UI/quota | Medium | プリセット適用が maxStocks をバイパス | FIXED |
| P1-05 | UI/a11y | Medium | 検索候補 listbox に combobox 連携がない | FIXED |
| P1-06 | UI/error | Low | StockDetailPage が取得失敗を握り潰し「最新」と読み上げ | FIXED |
| P1-07 | UI/security | Low | ニュース URL が無検証で href に流れる | FIXED（https + 許可ホスト） |
| P1-08 | UI/a11y | Low | role=button 入れ子（4画面） | FIXED: カードから role/tabIndex を外し、タイトル部分の実ボタンへキーボード操作を集約（DOM 検証済み） |
| P1-09 | UI/state | Low | ウォッチリスト追加が楽観確定 | FIXED |
| P1-10 | UI/auth | Low | 秘密の暗号変更が adminToken 欠落を成功扱い | FIXED（Worker 契約確認済み） |
| C1 | UI/auth | Medium | ロックアウト後に古い Turnstile トークンが残る | FIXED |
| C2 | UI/a11y | Medium | モーダル背景に inert/aria-hidden がない | FIXED（共有参照カウント、入れ子対応） |
| C3 | UI/a11y | Medium | Escape がドロワーとモーダルを同時に閉じる | FIXED（Sidebar がモodal存在時は委譲、App の重複リスナー削除） |
| C4 | UI/state | Low | 非同期送信 reject で loading が戻らない | FIXED |
| C5 | UI/quota | Low | AddStockModal が管理者に maxStocks を誤適用 | FIXED |
| C6 | UI/resource | Low | TradingView の script onload を描画完了と誤判定 | FIXED: 描画完了判定をやめ、常時表示の公式サイト導線を追加（iframe 未描画でも復帰可能） |
| C7 | UI/a11y | Low | role=option 内の操作ボタン | FIXED: 行アクションを listbox 外のフッターへ移動し、選択項目に対して操作（DOM 検証済み） |
| C8 | UI/a11y | Low | 固定 DOM id の重複 | FIXED: ConfirmModal の description id と PerformanceChart/SimulationPreview の gradient id を useId 化（2インスタンスの一意性を DOM 検証） |
| C9 | UI/a11y | Low | 条件付き input への label 参照 | FIXED |
| C10 | UI/a11y | Low | LoadingScreen が reduced-motion 無視 | FIXED |
| C11 | UI/state | Low | 最近の検索の React key 重複 | FIXED |
| I1 | CI | Medium | CI dry-run がプレースホルダ設定を検証 | DISCARD: 実測 `wrangler deploy --dry-run --config wrangler.jsonc` は EXIT 0 で ID 形式を検証せず、bundle/bindings ゲートとして機能 |
| I2 | scripts | Medium | `parseWranglerJson` が fail-open | FIXED |
| I3 | scripts | Medium | backfill 失敗が警告のみ | FIXED（再実行可能な例外へ） |
| I4 | scripts | Medium | meta-test gate が直接 readFileSync 形を検出しない | FIXED |
| I5 | scripts | Low | check-first-paint が属性順依存 | FIXED（属性名ベース＋静的 import 漏れ検出） |
| I6 | CI/worker | Low | 必須 secret の事前検証なし＋ `ADMIN_SECRET_CODE` 未設定時に汎用401でロックアウト消費 | FIXED: 非ローカルで D1/env の両方に第二要素が無い場合は `unavailable:true` + Secret 名入り 503 を返し、ロックアウト枠を消費しない |
| I7 | scripts | Low | apply-migrations の引数 fail-open | FIXED |
| I8 | config | Low | build が NODE_ENV を固定していない | FIXED（build 時に production、test 時の補正は共存） |
| I9 | CI | Low | 生成 d.ts の鮮度ゲートなし | DISCARD: 生成物は IDE/型検査用で、Worker は `Env` を独自宣言。鮮度違反はコンパイル時に顕在化し、ランタイム契約を壊さない |
| API1 | API境界 | Medium | chart だけ /api/calculate を8sで打ち切り合成系列へ | FIXED（30s 契約へ統一） |
| API2 | API境界 | Low | Turnstile config 失敗時に本番でテストキーへ | FIXED（production は空 siteKey + fail-close UI） |

## 独立再レビューで追加された課題（N1–N5）

| ID | Area | Sev | 課題 | 状態 |
|---|---|---|---|---|
| N1 | worker/API | Medium | `/api/auth/turnstile-config` が本番ホストでもテスト site key を配布し、API2 の修正がクライアント側のみだった | FIXED: `isLocalHostname` で判定し、本番＋未設定時は `siteKey:""` + `unavailable:true` |
| N2 | worker/data | Medium | screener が quote 失敗時に前回ライブ行を無印で再利用し LIVE 時刻を更新 | FIXED: `else if (prev)` 分岐を明示的に stale（`isDemoData:true`）として扱う |
| N3 | UI/a11y | Low | フルスクリーン／非 body のポータル内で背景 inert が兄弟要素に届かない | FIXED: ポータル直下の子まで辿り、その兄弟を対象化。取得ごとに再走査し後から追加された要素もカバー |
| N4 | data | Low | カレンダキャッシュの未来タイムスタンプが無期限 fresh（L1 と同種） | FIXED: `MAX_CACHE_CLOCK_SKEW_SECONDS` を共有し拒否 |
| N5 | worker/quota | Low | sync 日次クォータが UTC 境界（JST 09:00）でリセット | DISCARD: `schema.sql:136` が `sync_quota` を「per-UTC-day budget」と明示仕様化。purge の cutoff も同一 UTC 日付で内部整合しており、JST 変更は既存行を無効化する仕様変更 |

### 作業再開後の独立レビュー（NEW-R1〜R3）

| ID | Area | Sev | 課題 | 状態 |
|---|---|---|---|---|
| NEW-R1 | UI/a11y | Low | GlobalSearch の listbox `id` / `aria-controls` が固定で、2ダイアログ同時表示時に解決先が曖昧 | FIXED: `useId` 由来の `listboxId` を双方で使用。2インスタンスの DOM で一意性と解決を検証 |
| NEW-R2 | hooks | Medium | `runSimulation` のローカル再計算分岐だけが coverage warnings を全消去し、補完価格の開示が消える | FIXED: effect の recompute 分岐と同じ `sameWarnings` 付き開示へ統一 |
| NEW-R3 | worker/auth | Medium | `ADMIN_SECRET_CODE` 未設定時に汎用401＋ロックアウト消費で、設定漏れと推測を区別できない | FIXED: 非ローカルかつ D1/env 未設定なら `unavailable:true` + Secret 名入り503、ロックアウト消費なし |

### 独立レビューの指摘による既存修正の补強

- L6: Worker 側 `/api/stock/fundamentals` も `market:"US"` を返していたため、クライアントと同じ category 解決を適用（API 契約も整合）。
- API2: 上記 N1 により「本番は空 siteKey」がサーバ側でも成立。
- I8: 実装場所は `package.json` ではなく `vite.config.ts` の `command === "build"` 分岐（挙動は確認済み、台帳の記述を訂正）。

## テスト品質監査（QA）

| ID | 指摘 | 処置 |
|---|---|---|
| QA-01 | 30s timeout テストが定数を import して期待値にしていたため定数自体の回帰を検出できない | `expect(CALCULATION_REQUEST_TIMEOUT_MS).toBe(30_000)` を追加 |
| QA-02 | 静的文字列 pin のテスト名が振る舞い検証のようだった | 「static contract」と明記し、振る舞いは `reviewP1StockDetail.test.tsx` が担当 |
| QA-03 | `getAllByText(...).length > 0` が常に真 | 固有の alert 文言を検証するアサーションへ置換 |
| QA-04 | `getByText(...).textContent.toMatch(...)` が常に真 | `findByText` で待機のみとし、実効アサーションは成功トースト未発行・logout 呼び出しに集約 |
| QA-05 | StrictMode テスト名が「スケルトンを残す」と読めた | 「clears the skeleton」へ訂正 |

## 横断展開の検索証跡

- **予算未伝播**: 全 `AbortSignal.timeout` / `deadline` / `timeoutMs` を worker と client で横断し、W1/W2/API1 を同一根因として修正。
- **来歴フラグの欠落**: `isDemoData` / `isDemo` / `lastUpdatedAt` / `market` / `fieldProvenance` の全使用箇所を横断し、W3/W5/P1-01/P1-02/P1-06/L6 を修正。
- **fail-open**: scripts と worker の `catch` / `console.warn` / 既定値フォールバックを横断し、I2/I3/I7/W4/API2 を修正。
- **identity churn / 開示の欠落**: hooks の全 `setSyncWarnings` を横断し、H2（参照 churn）と NEW-R2（ローカル再計算で開示が消える）を同一ヘルパーへ集約。
- **抑制の有無**: 新規差分に `any` / `@ts-ignore` / `@ts-nocheck` / `eslint-disable` / `.skip` / `.only` / debug `console` がないか最終監査で確認（下記）。

## 検証（最終）

| コマンド | 結果 |
|---|---|
| `npm test`（coverage gate + meta-test gate + Vitest） | PASS: 336 files / 2916 tests、orphan 0、pins 1226 / 87 files |
| `npm run lint`（`--max-warnings=0`） | PASS |
| `npm run build`（app/worker/test の3 tsc + vite build） | PASS |
| `npm run check:first-paint` | PASS: 807,109 B raw / 226,532 B gzip（予算内） |
| `npx wrangler deploy --dry-run --config wrangler.jsonc` | PASS: 946.19 KiB / gzip 153.96 KiB |
| `git diff --check` / `git status --porcelain` | PASS（最終監査で再確認） |

## 修正中に発生した回帰と再修正（-self-inflicted）

1. 古い仕様を固定する3件のソース文字列アサーション（applyMigrations 2件 / StockDetailPage 1件）が失敗 → 新契約へ書き換え（アサーション数維持）。
2. Turnstile fallback を production のみ空にした影響で Node 環境の既存テストが失敗 → hostname 空は local/test として扱い互換維持。
3. レガシー配列カレンダを廃棄した影響で既存の「不正イベントを除いて有効イベントを残す」テストが失敗 → 捨てずに TTL 付き形式へ移行する根本修正へ変更。
4. JST テストがホスト TZ に依存していた → `jstDateString` を固定する決定的テストへ変更（修正前失敗を再確認済み）。
5. 独立レビュー修正の後、`^TOPX/^TOPIXG` の ETF プロキシが `INDEX` に変わり既存契約（PRIME）を破った → `querySymbol.endsWith(".T")` のプロキシは既存 market を維持するよう修正。
6. N3 の背景 inert が他ダイアログのオーバーレイまで無効化し combobox が消えた → 他ダイアログを含む要素は背景から除外。
7. 本番 Turnstile 判定に `isLocalOrTestHost` を使ったためテストランタイムで常に local 扱いになり N1 テストが失敗 → 配布先の判定は `isLocalHostname` に変更。
