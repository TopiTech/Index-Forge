# 包括的コードレビュー — 課題トラッカー

> 生成日: 2026-10-25 / 対象: `main` @ `13f3a2a` / モード: BUILD（調査のみ・修正なし）
> スコープ: prod 107 ファイル全件精査（UI / backend / DB・データ層 / 共通・設定 / API境界・型整合性・バリデーション・エラー形式）、
> 正常系＋エッジ/異常系＋非同期競合＋リーク＋セキュリティ＋パフォーマンス。
> 手法: 全件 `wc -l` 走査＋ `grep` 横断スイープ（fetch/storage/JSON/crypto/timer/postMessage/CSP/rate-limit/`as`/non-null/`console`）＋主要ファイル精読。
> 重要度表記は本プロジェクト運用（Critical/High/Medium/Low-Perf-A11y）。code-review スキルの BLOCKER/MAJOR/MINOR/NIT への対応は各見出しに併記。

## 0. ベースライン（本ファイル作成時に再取得・記録）

| チェック | コマンド | 結果 |
|---|---|---|
| test | `npm test` | ✅ PASS — 229 files / 2174 tests passed (8.15s) |
| typecheck (app) | `npx tsc -p tsconfig.app.json --noEmit` | ✅ PASS (exit 0) |
| typecheck (worker) | `npx tsc -p tsconfig.worker.json --noEmit` | ✅ PASS (exit 0) |
| typecheck (test) | `npx tsc -p tsconfig.test.json --noEmit` | ✅ PASS (exit 0) |
| lint | `npm run lint` | ✅ PASS (exit 0, `--max-warnings=0`) |
| build | `npm run build` | ✅ PASS (exit 0, vite built in 4.04s) |

注記: リポジトリ既存の `vitest_results.json` は古いログ（1139 tests / 6 failed / `success:false`）だが、
今回実測では全件グリーン。旧ログは更新対象外とし、最新実測を正とする。

---

## 1. Critical ［BLOCKER］（セキュリティ / データ破壊 / 認証迂回）

### C-1 ［BLOCKER］ `getClientIp` の `X-Real-IP` 無条件信頼 — レート制限迂回
- **対象**: `worker/internal-impl.ts:5233-5250`（`getClientIp`）
- **問題/リスク**: `CF-Connecting-IP` 不在時に `X-Real-IP` をそのまま採用し、最後段に `X-Forwarded-For` right-most を使う。
  直接クライアントが両ヘッダを偽造でき、`checkRateLimit`（`worker/internal-impl.ts:5405`）/
  `sync_quota`（`:8429` 以降）/ admin lockout（`:1515` 以降）の IP キー全体が迂回可能。
- **横断**: `grep getClientIp worker/internal-impl.ts` 全使用箇所（snapshot/ticker/market/calendar/indices/sync/calculate/admin-login/turnstile-config）。
- **修正方針**: 本番は `CF-Connecting-IP` 必須、それ以外は `unknown` 扱いで厳格側に倒す。dev フォールバックは `isLocalOrTestHost` 配下に明示分離。

### C-2 ［BLOCKER］ 管理者認証の二重運用（`x-admin-session` 移行済みだが旧ヘッダ併存）
- **対象**: `src/lib/auth.ts:getAuthHeaders`（`x-admin-session`＋`x-auth-password`/`x-admin-key` 併送）、
  `worker/internal-impl.ts:1900-1901, 2375-2393, 6373-6375`（旧ヘッダ受容）、`authenticateAdmin`＋`isAdminPasswordFallbackAllowed`
- **問題/リスク**: SEC-01 で session 必須化したはずが旧ヘッダが残り、境界が二重化。テスト用フォールバックフラグの本番混入余地。
- **横断**: `grep "x-admin-key\|x-auth-password" src worker` — `AdminDashboard.tsx` の6 fetch、`EditPasswordModal.tsx:125`、`useAuth.ts:logout` を含む。
- **修正方針**: 本番 deny・テスト allow の切替を一元化し、旧ヘッダ送信を停止。`getAuthHeaders` を session 単一に。

### C-3 ［MAJOR］ 所有者トークン `issuedAt` の seconds/ms 自動判別と保存/判定の食い違い
- **対象**: `src/lib/ownership.ts:parseEntry`（`<1e11` 判定）、`worker/internal-impl.ts:lookupIndexOwnership`＋`prepareIndexUpsert`
- **問題/リスク**: 境界値で誤分類→403/所有権喪失。`COALESCE(subselect)` 保存と `OWNER_TOKEN_MAX_AGE` 判定のペアが崩れると期限切れ判定が食い違う。
- **横断**: `grep "owner_token_issued_at\|OWNER_TOKEN_MAX_AGE" src worker`、`POST /api/indices`（`:7779`）/`DELETE /api/indices`（`:8336`）。
- **修正方針**: 単位を ms に統一し、不正値は破棄（推測補完しない）。保存/判定のペアテスト追加。

### C-4 ［MAJOR］ `seed.sql` の `basket_items` が依然 `INSERT OR REPLACE`
- **対象**: `seed.sql`（basket 全行）、対比 `schema.sql`
- **問題/リスク**: indices 側は所有者メタデータ保持 upsert 済みだが basket 側は REPLACE のまま。seed 再実行で一時的 basket 消失・CASCADE 誤発の窓。
- **横断**: `grep "INSERT OR REPLACE" seed.sql schema.sql worker/internal-impl.ts`（`prepareBasketItemWrites` は REPLACE 使用 — 意図的か要確認）。
- **修正方針**: basket も `ON CONFLICT(index_id,ticker) DO UPDATE` 化。

### C-5 ［MAJOR］ 平文パスワードのメモリ・`sessionStorage` 残留
- **対象**: `src/lib/auth.ts:memoryAuthSession`＋`sessionStorage` 保持、`getAuthHeaders` で毎回送信
- **問題/リスク**: XSS 成立時に即漏洩。現設計は sessionStorage 限定＋legacy localStorage 削除のみで軽減。
- **横断**: `grep "localStorage\|sessionStorage" src` 約40件 — auth 除く用途（sidebar 折畳、indices/etag、sync、owner）は鍵ではない。
- **修正方針**: 短期＝送信ヘッダ最小化・保持期間短縮、長期＝HttpOnly cookie 移行。

---

## 2. High ［MAJOR］（レース / リーク / 誤った正常系）

### H-1 無認証 `/api/sync-prices` の面＋quotaは日次ticker数のみ
- **対象**: `worker/internal-impl.ts:8429-8560`
- **問題**: `force` 以外無認証で Yahoo fetch＋D1 write を消費。`MAX_SYNC_TICKERS_PER_REQUEST=12`・`SYNC_DAILY_TICKER_BUDGET` はあるが分散 IP 並列消費が可能。
  `isSyncFailureBackedOff` がメモリのみ（isolate recycle で消失）で再突入可能。
- **横断**: `HIGH_FREQUENCY_RATE_LIMIT_ENDPOINTS`（in-memory のみ）vs D1 レート制限の使い分け表。

### H-2 D1 `rate_limits` の probabilistic purge（`Math.random()<0.01`＋`waitUntil`）
- **対象**: `worker/internal-impl.ts:5421-5432`、`scheduled:purgeExpiredSecurityRows`（`:9058`）
- **問題**: 低トラフィック時に purge が回らず増殖、上限・課金圧迫。ローカル dev では cron 不発。
- **横断**: `grep "purgeExpiredSecurityRows\|waitUntil" worker/internal-impl.ts`。

### H-3 クライアント計算キャッシュ `clientCalcCache` が無期限・TTLなし
- **対象**: `src/hooks/useCalculation.ts:MAX_CLIENT_CALC_CACHE_SIZE=50`（LRU のみ・時刻失効なし）
- **問題**: 価格更新後に古い series を返す可能性。`useBenchmark:benchmarkSessionCache`（5min TTL） とポリシー不統一。
- **横断**: `grep "clientCalcCache\|benchmarkSessionCache" src/hooks`。

### H-4 `calculateCustomIndex` の forward-fill が欠測を隠蔽
- **対象**: `src/lib/indexEngine.ts:stockPriceMatrix`（`lastPrice` 前日流用）
- **問題**: 長期欠測銘柄が直近値で張り付く。`syncStatus {total,found}` のみで欠測率を開示しない。
- **横断**: `calculateCustomIndex` 使用＝`useCalculation`・`useSimulation`・`/api/calculate`。

### H-5 `parseJsonBody` の全ボディ buffering（1MB cap）
- **対象**: `worker/internal-impl.ts:5247-5295`
- **問題**: reader loop で `chunks` 蓄積後一括 decode。大 payload でメモリ増大。Content-Length 偽装時は読切まで課金。
- **修正方針**: 上限到達で即時 413＋`reader.cancel()`（実装済み）を維持しつつ、早期 decode・上限引下げ検討。

### H-6 ポートフォリオIDが `Date.now()+counter` 依存（混在）
- **対象**: `src/lib/portfolioStorage.ts:createPortfolioPositionId`、`src/App.tsx:1105,1138`、`src/components/IndexBuilderContent.tsx:392,593`
- **問題**: `safeRandomId`（`src/lib/randomId.ts`）があるのに時刻ベース ID が混在。同一 ms＋リロードで counter reset→衝突・React key 重複・誤削除。
- **横断**: `grep "Date.now()" src | grep "id.*=\|id:"` 全件を `safeRandomId` 系に統一。

### H-7/H-8 TradingView widget の `innerHTML` クリア＋`postMessage(JSON.parse)` 無ガード
- **対象**: `src/components/StockTechnicalChart.tsx:319,594,681`、`src/components/TradingViewChartModal.tsx:485,559`、
  `src/components/TurnstileWidget.tsx:168`
- **問題**: H-7＝widget 再生成時の innerHTML クリア（定数 sink だが CSP との整合要確認）。H-8＝`event.data` の `JSON.parse` に try/catch なし＋origin 検証なしに近い→例外で effect 中断。
- **横断**: `grep "innerHTML\|postMessage\|addEventListener(\"message\"" src`、`marketDataService.ts:1810,2180,2425,2605` の非ガード `await res.json()`（`apiContract.readJsonBody` 未使用）も同根（M-8）。

### H-9 管理画面の AbortController 未 cleanup
- **対象**: `src/components/AdminDashboard.tsx:290-310,350-408`（`statsAbortControllerRef/abortControllerRef`）
- **問題**: unmount 時の中止なし。`setPasswordFetchError` の競合で古い成功が新しい失敗を上書きし得る。
- **横断**: `grep "AbortController" src` — `TradingViewTickerTape`・`useBenchmark`・`useCalculation`・`useIndices` は整備済みで対照。

### H-10 `useBenchmark` session キャッシュが ETag と時刻を混用
- **対象**: `src/hooks/useBenchmark.ts:126,217,234`
- **問題**: 304 時に `cached.timestamp=Date.now()` で TTL 延長→stale 永続化。共有 Map でタブ間乖離。
- **修正方針**: 304 は鮮度延長ではなく検証成功として扱い、TTL は取得時刻基準に固定。

---

## 3. Medium ［MAJOR/MINOR］（API境界・バリデーション・型・UX破綻）

| # | タイトル | 対象（file:line） | 横断ヒット |
|---|---|---|---|
| M-1 | `validateBasketItems(requireTheme)` の非対称 | `src/lib/apiContract.ts`、worker `:8827`（calculate 必須）vs stock 単品任意 | `grep requireTheme src worker` |
| M-2 | ticker 正規化の二重定義 | `src/lib/indexEngine.ts:normalizeTicker` vs `src/lib/yahooSymbol.ts:toYahooSymbol` | `grep normalizeTicker\|toYahooSymbol src worker` 全使用 |
| M-3 | `filterByTimeframe` が出来高暦ベース近似 | `src/lib/timeframe.ts:filterByTimeframe` | 休場日・欠測時のずれ、YTD のみ JST 修正済み |
| M-4 | `toFixed→Number` 連鎖の二重丸め | `src/lib/indexEngine.ts:21,46,116,247,360`、`chartData.ts:67` | `redistributeWeightsExact` は整数 units で正しいが表示側が再丸め |
| M-5 | weight 0 の表示/保存の二段構え | `src/hooks/useIndices.ts:sanitizeIndex` vs `repairMissingWeights` | 0-weight の意味（除外 vs 未設定）が UI に非開示 |
| M-6 | ETag が `JSON.stringify` キー順依存 | worker `:calcCacheFingerprint`、`generateETag` | basket 順は有意だが空白差で別 ETag→HIT 低下 |
| M-7 | CORS localhost のみ＋日英エラー混在 | worker `:json`/`:notModified`（`isAllowedOrigin`） | LAN 検証が fetch 失敗に見える、CORS と 429 の切分け困難 |
| M-8 | エラー形式不統一＋`.catch(()=>({}))` 握りつぶし | `src/lib/auth.ts:359,460,514,586`、`AdminDashboard.tsx:323,377`、`apiContract.ts:readJsonBody` 未適用多数 | `grep "res.json()" src` 約20件 |
| M-9 | 平文キャッシュと ETag/body 不整合時の張り付き | `src/hooks/useIndices.ts:109,127`、`syncCache.ts`、`ownership.ts` | `getIndicesRequestHeaders` が ETag のみで body なし→304 時に fallback 固定 |
| M-10 | modal/drawer の focus・scroll lock 競合 | `src/App.tsx:473,498,542`、`useModalFocus.ts`、`ModalBase.tsx:37`、`TradingViewChartModal:pendingTimersRef` | 複数 modal 同時開で `body.overflow` 復元が早い者勝ち |
| M-11 | `Tutorial3DScene` の非決定的配置＋非同期 dispose | `Tutorial3DScene.ts:199,680,158,906` | `Math.random` 配置で snapshot 不可、load 中 unmount で GPU リーク |
| M-12 | `wrangler.local.jsonc` が実 ID 付きで残存 | ルート直下（実 `database_id` 含有） | `.gitignore` 除外のはずが worktree に存在→誤 commit・ログ流出の危険 |
| M-13 | `crypto.randomUUID()` の直使用（Worker） | `worker/internal-impl.ts:5886,7837` | クライアント `safeRandomId` と ID 形式・強度要件が不統一 |

---

## 4. Low / Perf / A11y ［MINOR/NIT］

| # | タイトル | 対象 |
|---|---|---|
| P-1 | first-paint budget は CI ゲート済みだが `stockUniverse` 混入余地 | `vite.config.ts:manualChunks`、`check-first-paint.mjs`、`marketDataService→popularStocksData` 参照 |
| P-2 | `index.css` 8460行＋`tokens.css` 二重管理 | デッドスタイル・詳細度競合の温床 |
| P-3 | チャート・heatmap の代替テキスト・キーボード操作が部分的 | `keyboardTarget.ts` はあるが適用が部分的 |
| P-4 | `console.error/warn` 40箇所超が本番残存 | Worker は observability `persist:true` で課金・ログ量増、PII 混入の恐れ |
| P-5 | 非nullアサーション4箇所＋`as` キャスト多数 | worker `:1903`（`authorization!.slice(7)` は欠落時 throw→500）、`:7745`、`:8942`、`ThemeHeatmap.tsx:40` |
| P-6 | `eslint-disable-next-line react-hooks/exhaustive-deps` 残存 | `Tutorial3DCanvas.tsx:152` |
| P-7 | `MAX_REQUEST_BODY_SIZE=1MB` × `MAX_BASKET_ITEMS=500` | 500件 basket で 413、英語文と UI 日本語期待の不一致 |
| P-8 | `todayJstDateString` の `Intl.DateTimeFormat` 毎回生成 | `portfolioStorage.ts`、module-level 化可 |

### ［PRAISE］良好点
- API 境界の一元化（`apiContract.ts`）・価格同期契約の一元化（`priceSync.ts`）・sync cache の単一所有者化（`syncCache.ts`）は同種ドリフトの根本対策として模範的。
- `ownership.ts` の null-prototype＋`defineProperty` による `__proto__` 対策、`auth.ts` の sessionStorage 限定＋legacy 削除は正しい方向。
- D1 レート制限の `INSERT … ON CONFLICT … WHERE` による原子スロット確保はレース対策として適切。

---

## 5. 論理修正単位（依存順・ common foundation / API 境界優先）

1. **U-1 API境界・契約の単一化**: M-1・M-2・M-5・M-8・P-5（`apiContract.ts` 中心。`validateBasketItems`・ticker 正規化・エラー形式・`readJsonBody` 全面適用）。
2. **U-2 認証・認可基盤**: C-2・C-5・C-1（`auth.ts`・`getAuthHeaders`・`getClientIp`・Worker `authenticate*` 一式。旧ヘッダ廃止、IP 信頼整理）。
3. **U-3 所有権・トークン基盤**: C-3（`ownership.ts`＋Worker `lookupIndexOwnership`/`prepareIndexUpsert`。単位統一・保存/判定ペア）。
4. **U-4 同期・キャッシュ基盤**: H-1・H-2・H-3・H-10・M-6・M-9（`sync-prices` quota・purge・`clientCalcCache`/`benchmarkSessionCache`・ETag・indices ETag/body）。
5. **U-5 計算・数値基盤**: H-4・M-3・M-4（`indexEngine`・`timeframe`・`chartData`・欠測開示）。
6. **U-6 永続化・DB**: C-4・H-6（`seed.sql` upsert、`portfolioStorage` ID 統一、migration 冪等）。
7. **U-7 UI 信頼性**: H-7・H-8・H-9・M-10・M-11（TradingView/Turnstile/postMessage、Admin abort、modal/focus、3D dispose）。
8. **U-8 設定・観測・仕上げ**: M-7・M-12・M-13・P-1〜P-8（CORS 文言、`wrangler.local.jsonc` 取扱い、ID 形式統一、CSS・ログ・lint 残件）。

各単位は「修正 → エッジ/異常系テスト追加・実行 → lint → build」の順で実施する。
型弱化（`any`・不当アサーション）・抑制コメント・スキップ/妥協は禁止し、根本原因を修正する。

---

## 6. ベースライン実行記録

- 実行日: 2026-10-25（本ファイル作成と同セッション）
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0
- `npx tsc -p tsconfig.worker.json --noEmit` → exit 0
- `npx tsc -p tsconfig.test.json --noEmit` → exit 0
- `npm run lint` → exit 0（warnings 0）
- `npm test` → Test Files 229 passed / Tests 2174 passed / Duration 8.15s
- `npm run build` → exit 0（vite built in 4.04s；`stockUniverse` 298KB / `ComposedChart` 416KB / `index` 464KB / `three` 563KB は遅延チャンク分離済み、first-paint 予算は `check-first-paint` が CI で担保）
- `git status` → 新規 `docs/` のみ。`dist/` は git 管理外のため worktree はクリーン。
- 結論: **全チェックがクリーンにパスしたクリーンベースラインを確立**。以降の修正（U-1〜U-8）はこの状態を基準にデグレ判定する。

## 7. U-1 完了記録（2026-10-25）

- 対象: M-1・M-2・M-5・M-8・P-5（§3 の U-1 定義通り）。C/H/M/P の他項目には触れていない。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし）:
  - M-2: 正規化を `src/lib/yahooSymbol.ts:normalizeTicker` に一元化。`indexEngine` は再エクスポート、`navigation` の私的複製は委譲、`validateBasketItems` は判定前に正規化（全角 Ticker の 400 二重境界を解消）。
  - M-1: `validateSingleStockItem` を `apiContract` に新設し、Worker `POST /api/indices/stock` の手書き検証を委譲に置換（theme 缺省 `カスタム`・weight 缺省 10・日本語メッセージは維持）。
  - M-5: `LEGACY_REPAIRED_WEIGHT = 1` を新設し、Worker reader と `sanitizeIndex` の両方から参照（表示 0 と保存時再均衡の乖離を解消）。
  - M-8: `isRecord`・`isApiErrorBody`・`extractApiErrorMessage`・`readResponseErrorMessage` を新設し、全 20 箇所の `res.json().catch`／非ガード `await res.json()` を `readJsonBody` 経由に移行（`auth.readApiErrorMessage` は委譲に書換、署名維持）。
  - P-5: 非nullアサーション 9 箇所を明示取得・ガードに置換（Worker 5: auth ヘッダ・set-cookie・liveMap・indicesMap・pricesByTicker／client 4: indexEngine・ThemeHeatmap・main root・既存対応済みを除く）。
- テスト: `apiContract.test.ts` に 4 新規 describe（M-2/M-1/M-5/M-8 計 20 件超の edge/abnormal）、`useIndices.test.ts` に legacy weight 修復、`workerApi.test.ts` に stock POST 全角・共有メッセージの回帰 2 件。旧挙動を pin していた 3 件（`persistedPayloadValidation`・`goalRoundReviewFixes`・`goalFollowupReview`）は意図変更に合わせて同等以上の強度で更新（理由は各テスト内に記録）。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 229 files / **2197 passed**、`npm run build` exit 0。
- 残: U-2〜U-8 は未着手。§1〜§5 の課題リスト自体は変更なし（U-1 5 件を closed として扱う）。

## 8. U-2 完了記録（2026-10-25）

- 対象: C-1・C-2・C-5（§5 の U-2 定義通り）。他ユニットには触れていない。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - C-1: `getClientIp` をホスト名判定でフォールバック制限。`CF-Connecting-IP` 不在時に `x-real-ip` / `x-forwarded-for` を信用するのは loopback 宛のみ（`isLocalHostname`）。本番ドメイン宛は `unknown` で fail-closed。`isLocalOrTestHost` ではなく `isLocalHostname` を使ったのは意図的で、`isTestRuntime()` 経由では本番挙動がテスト不能になるため。全既存テストは localhost URL のためグリーン維持。
  - C-2: `getAuthHeaders` から重複エイリアス `x-admin-key` の送信を廃止（Worker は等価に扱うため機能ゼロ・露出のみ）。`getAdminSessionHeaders(session?)` を新設し、`/api/admin/*`（AdminDashboard 全 7 箇所＋secret-code・EditPasswordModal 経由）および `/api/auth/logout` をセッション単一化。サーバ側は旧ヘッダ受容を維持し deprecated alias として注記（旧キャッシュ前端の互換保持）。`authenticateAdmin` の本番 session 必須ゲートは既に単一化済みのため変更なし。
  - C-5: 上記により平文パスワードの送信先を「評価する endpoint のみ」に最小化（管理系・logout から排除、重複ヘッダ排除）。保管は tab-scoped のまま（sessionStorage＋memory、localStorage 不使用は維持）。URL・ログへの平文混入は横断 grep で不存在を確認。
- テスト: C-1＝public hostname での spoofable 無視 4 件＋既存 localhost pins 維持。C-2/C-5＝`getAdminSessionHeaders` 4 件（admin/user/無token/無session）、logout の user 時 no-fetch 化、`getAuthHeaders` 変更に伴う 3 件の pin 移行（`round2AuthClient`・`authStorage`・`securityAndAdmin`、いずれも旧実装綴りを新綴りに同等強度で更新）。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 229 files / **2206 passed**、`npm run build` exit 0。
- 残: U-3〜U-8 は未着手。

## 9. U-3 完了記録（2026-10-25）

- 対象: C-3（§5 の U-3 定義通り: `ownership.ts`＋Worker `lookupIndexOwnership`。単位統一・保存/判定ペア）。他ユニットには触れていない。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - 単位単一化: 秒/ms 境界の `<1e11` 判定を `ownership.ts` 内の `toIssuedAtMs` に集約（`parseEntry`・`saveIndexOwnerToken` の私的複製を委譲に置換、挙動は同一のため既存 pin 4 件はグリーン維持）。API 境界の変換は `serverIssuedAtToMs` に一元化し、`useIndices.saveCustomIndex` のインライン変換を削除。POST/DELETE の header+body 送信は既存テストが pin する意図仕様のため維持。
  - 保存/判定ペア（client）: `persistConfirmedOwnerToken` を新設。echo 時のみ永続化し、(a) echo＋age→server age を保存、(b) 同一 token の echo で age 欠落→stored age を保持（従来の `now` 書換え＝sliding window を廃止。Worker は元の絶対年齢で 403 するため client が fresh と誤認する乖離を解消）、(c) 新 token の age 欠落→now（mint 意味論と一致）。echo なし（admin 維持・legacy schema）は store 不変。`getEchoedOwnerToken` を新設し `resolvePersistedOwnerToken` は委譲（署名維持・既存 pin グリーン）。
  - 保存/判定ペア（Worker）: `lookupIndexOwnership` が present-but-unparsable セル（文字列ゴミ・Infinity）を `null`（grandfather）に混入させていたのを `0` に正規化し fail-closed 化（`isOwnerTokenExpired(0)=true`、D1 bind・round-trip とも expired で自己整合）。SQL NULL（追跡前 row）→grandfather、`undefined`（列欠落）→従来通りは不変。docstring の「unparsable は expires」記述と実装の矛盾を解消。`prepareIndexUpsert` は lookup 値の preserve で既にペア成立のため変更なし。
- テスト: 新規 23 件。`ownership.test.ts` に `serverIssuedAtToMs` 9 件＋`persistConfirmedOwnerToken` 6 件（age 保持の回帰含む）＋期限切れ prune 1 件。`useIndices.test.ts` に `getEchoedOwnerToken` 8 パターン＋保存パス source pin。新規 `useIndices.ownerPersist.test.tsx` に hook レベル 3 件（echo 秒→ms／echo なし不変／echo age 欠落で age 保持）。Worker `round2OwnerTokenLegacy.test.ts` に lookup 正規化 6 件＋POST/DELETE 403 ペア 2 件（ゴミセル→有効期限メッセージ）。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 230 files / **2242 passed**、`npm run build` exit 0。
- 残: U-4〜U-8 は未着手。

## 10. U-4 完了記録（2026-10-25）

- 対象: H-1・H-2・H-3・H-10・M-6・M-9（§5 の U-4 定義通り）。他ユニットには触れていない。
- 事前精査の結論（誤検知の除外・過剰修正の回避）: H-1 の面・quota・backoff は現行実装で既に対処済み（per-request 上限 12・D1 原子 quota・force のパスワード必須化・in-memory backoff の上限付き化＋legacy 負マーカー読取の併用）。分散 IP 並列消費と recycle 後の再突入は製品判断を要する残余リスクとして文書化済みの設計であり、コードでは直せない。H-2 は cron trigger が prod/local 両 `wrangler.*.jsonc` に設定済みで scheduled purge が本命、1% 確率 purge は日和見層、4 テーブル purge は pin 済み。M-6 は U-1 の `validateBasketItems` 一元化で fingerprint 入力が正準化済み（ticker 正規化＋name/theme trim＋weight 域検査）。M-9 は `getIndicesRequestHeaders(cachedIndices)` ゲートで ETag/body ペア不整合を解消済み。これら 4 件は検証＋不足 pin の追加に留め、コード変更なし。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - H-3: `getClientCalcCache` の読取を市場時刻対応 TTL でゲート。`isPriceCacheFresh`（sync 判定と同一ポリシー）を再利用し、stale は miss 扱い＋prune。timestamp の保持だけでは鮮度が保証されない構造を、計算結果の鮮度＝元価格の鮮度という単一ポリシーに統一して解消。
  - H-10: `useBenchmark` の 304 処理で `cached.timestamp` の bump を廃止。304 は検証成功として cached data を返すが、TTL と `lastUpdatedAt` は取得時刻基準に固定（表示の「最終更新」偽装とタブ滞在中の半永久 fresh 化を解消）。サーバ ETag が内容ハッシュのため 304 時のデータ正当性は不変。
- テスト: 新規 9 件。`useCalculationCache.test.ts` 5 件（fresh hit／48h stale→miss＋prune／未来時刻／zero／LRU 位置維持）。`round2BenchmarkSessionCache.test.tsx` に 304 回帰 1 件（If-None-Match 送信＋cached 配信＋`lastUpdatedAt` 不変を時刻移動で検証）。`apiContract.test.ts` に M-6 fingerprint 入力正準 1 件（空白・全角・大小文字差→byte-identical）。`useIndices.test.ts` に M-9 pin 1 件（ETag 喪失時は条件付き送信なし）。H-1/H-2 は既存 pin（force 未指定 401・quota 上限 429・原子 batch・4 テーブル purge）でカバー確認。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 231 files / **2250 passed**、`npm run build` exit 0。
- 残: U-5〜U-8 は未着手。

## 11. U-5 完了記録（2026-10-25）

- 対象: H-4・M-3・M-4（§5 の U-5 定義通り: `indexEngine`・`timeframe`・`chartData`・欠測開示）。他ユニットには触れていない。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - H-4: 日付×銘柄マトリクスを `buildIndexPriceMatrix` に抽出し単一化。`calculateCustomIndex` は同マトリクスを読むだけにし、値の同一性は既存 golden（forward-fill 1050 等）＋全スイートで担保。マトリクスはセル毎に `real/pre/gap/trailing` を記録し、新設 `computeIndexCoverage` が同一マトリクスから欠測開示（最新日の trailing・期間内 gap 日数・補完セル率。設計上の pre-start base 錨は欠測に数えない）を算出。API 変更なし（client が universe を持つため現地計算）。`getIndexCoverageWarnings`（pure・黙認文言を一元化）を `useCalculation`・`useSimulation`（fetch 経路＋recompute 経路。デモ universe は全セル synthetic-real のため警告なし）の sync 警告に配線。
  - M-3: `filterByTimeframe` の固定点数（5/22/65/130）を JST 暦カットに置換。系列自身の最新日を起点（stale 系列を空にしない・最新点は常に含む）、月末クランプ・未ソート・不正日付に耐性。YTD（JST 済）と 1Y（全件）は不変。ラベル「1か月」と表示範囲の乖離という根本を修正。
  - M-4: `normalizeWeights` の中間 `toFixed(4)` を廃止し完全精度を通す。丸めは出力境界の既存 `toFixed(2)` の一度だけに単一化（`equalize/redistributeWeightsExact` の整数 units・`chartData:67`・`:360` の最終丸めは単発で正しいため不変）。
- テスト: 新規 19 件。`indexCoverage.test.ts` 7 件（gap/trailing/pre-start/空/全欠測/文言圧縮＋値 parity）。`timeframe.test.ts` 8 件（1M 暦・疎系列・1W・月末クランプ・未ソート・最新点保証・不正日付・1Y/空/3M/6M）。`indexEngine.test.ts` に M-4 1 件（完全精度＋4dp 否定）。`useCalculationCoverage.test.tsx` に配線 1 件（renderHook＋sync キャッシュ事前投入で calculate 1 fetch のみ。最新日 warning の銘柄特定＋無実銘柄の非含有を検証）。既存 26 件（matrix 値 parity 含む）は全グリーン維持。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 234 files / **2268 passed**、`npm run build` exit 0。
- 残: U-6〜U-8 は未着手。

## 12. U-6 完了記録（2026-10-25）

- 対象: C-4・H-6（§5 の U-6 定義通り: `seed.sql` upsert、`portfolioStorage` ID 統一、migration 冪等）。他ユニットには触れていない。
- 事前精査の結論: Worker `prepareBasketItemWrites` の REPLACE は同一 batch 内で先行 DELETE 後に挿入されるため実質 INSERT と等価で無害と確認し、変更なし（U-6 対象は seed のみ）。migration は `scripts/apply-migrations.mjs` が probe-gated（未適用 step のみ実行）＋backfill UPDATE 冪等で既に対処済みと確認し、コード変更なし。`App`・`IndexBuilderContent`・`AdminDashboard`・`indexSerialization` の ID は既に `safeRandomId(6)` 付きで衝突耐性があり、真に脆弱なのは `createPortfolioPositionId` の counter のみと特定。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - C-4: `seed.sql` の basket 5 文を `INSERT OR REPLACE` から `ON CONFLICT(index_id, ticker) DO UPDATE` に置換（`schema.sql` の `UNIQUE(index_id, ticker)` を根拠に記載）。DELETE+INSERT による AUTOINCREMENT 消費と行 identity 変動を解消。indices upsert は既存のまま。
  - H-6: `createPortfolioPositionId` を `Date.now()+counter` から `pos-${ticker}-${shares}-${safeRandomId(8)}` に置換。counter はリロードで reset されるため同時刻・同内容ロットが衝突する根本を、64bit 乱数の一意性に置換。`sanitizePosition` は任意の非空 id を受容するため既存保存データは全て有効のまま。
- テスト: 新規 6 件。`seedIdempotence.test.ts` 4 件（OR REPLACE 残存の source pin・全 basket 文の upsert 対応・`node:sqlite` 実実行での再実行時の件数＋行 id 不変・seed 値復元と owner メタデータ保持の両立）。`portfolioStorage.test.ts` に H-6 2 件（同一 ms 100 ロット一意・`vi.resetModules` による reload シミュレーションでの一意性＋prefix 互換）。既存 pin（`pos-7203-10-` prefix・同一 ms 2 ロット）は全グリーン維持。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 235 files / **2274 passed**、`npm run build` exit 0。
- 残: U-7〜U-8 は未着手。

## 13. U-7 完了記録（2026-10-25）

- 対象: H-7・H-8・H-9・M-10・M-11（§5 の U-7 定義通り）。他ユニットには触れていない。
- 事前精査の結論（誤検知の除外）: H-7 の `innerHTML = ""` 5 箇所は全て定数空文字 sink で XSS なし。H-8 は `StockTechnicalChart` の try/catch＋cleanup 済み、他に message listener は存在しない。H-9 は generation guard＋`isMountedRef`＋effect cleanup での両 controller abort 済み。`marketDataService` の非ガード `res.json()` 4 箇所は `readJsonBody`＋content-type 判定に移行済み。`TradingViewChartModal` の timer は `pendingTimersRef` で unmount 一括 cancel 済み（pin あり）。いずれもコード変更なし。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・後方互換を破壊しない）:
  - M-10: `body.style.overflow` の単一所有者を `useModalFocus.ts` の `acquireBodyScrollLock()` に集約（ref-count。先取得者の値を保存し最終解放でのみ復元、二重解放は no-op）。dialog は同関数経由に書換（等価）、`App` の nav drawer／mobile sidebar の独立 save/restore を同関数利用に置換。非ネスト close 順（drawer 先閉じ→modal 後閉じ）でのスクロール復元破壊という根本を解消。
  - M-11: `Tutorial3DScene` の装飾配置を `Math.random` から `createSeededRandom`（mulberry32）に置換。`seed` option 付き・既定は固定 `TUTORIAL_SCENE_DEFAULT_SEED` で毎回同一レイアウト（snapshot 可能・リロード安定）。アニメーションの時刻依存（`Math.sin(t)` 等）は意図する動的表現のため不変。async loader は存在せず、`destroy()`（RAF cancel＋traverse dispose＋forceContextLoss）と Canvas の context lost/restore・StrictMode 対応は既に完全と確認。
  - H-8: symbol-error 形状判定を `isTradingViewSymbolError` として抽出・export（listener 側の try/catch＋cleanup は不変）。判定規則の将来 drift を防ぐ testable 化。
- テスト: 新規 21 件。`useModalFocus.scrollLock.test.ts` 4 件（単純 acquire/release・複数 owner・非ネスト close 順の回帰・二重解放耐性）。`Tutorial3DScene.test.ts` に PRNG 3 件（同一 seed 一致・異 seed 相違・[0,1) 範囲）。`StockTechnicalChart.test.ts` に predicate 14 パターン（5 陽性・9 陰性）。H-7/H-8/H-9/Modal timer は既存 pin でカバー確認。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 236 files / **2295 passed**、`npm run build` exit 0。
- 残: U-8 は未着手。

## 14. U-8 完了記録（2026-10-25）

- 対象: M-7・M-12・M-13・P-1〜P-8（§5 の U-8 定義通り）。他ユニットには触れていない。
- 事前精査の結論（誤検知・対処済みの除外、コード変更なし）:
  - P-2: 誤検知。`src/global.css` は存在せず、`tokens.css` の重複名は `[data-theme]`／`[data-accent]` バリアントの正規 override（`tokens.css:169-322`）で二重管理ではない。`index.css` は `@import "./styles/tokens.css"` 単一取込＋`:root` は typography ベースラインのみ。
  - P-1: 対処済み。`stockUniverse`（336KB）の静的 import は lazy route（`CalendarPage`・`GlobalSearchModal`・`StockAnalysisPage` は `App.tsx` で `lazy()`＋hover preload）と `marketDataService:2159` の動的 import のみ。`npm run build` で `stockUniverse-*.js` が遅延チャンク分離、`check-first-paint`（CI ゲート）が OK を維持。
  - P-4: 監査の結果、除外。`console.*` は全て catch ハンドラ・WebGL フォールバック・Worker のサーバー側診断のみで、token/password/key/secret・header・生 body を出力する箇所はゼロ（`grep console.*Token|Password|Key|Secret|Header` で確認）。hot path の noise log なし。`observability persist:true` は `wrangler.jsonc` で意図明示の運用選択。
  - P-5: 対処済み・正当化。`!` アサーションは `src`・`worker` ともにゼロ残存。`ThemeHeatmap.tsx:40` は既にクリーン。worker `:7745`/`:8942` の `as D1Row[]` は D1 `results: unknown[]` に対する定型 narrow で、直後に `String()/Number()` 強制＋フォールバック（`:7756-7790`）・`if (row.ticker && row.prices)`＋`try/catch JSON.parse` のガード済み。
  - M-7 CORS 部分: 意図された姿勢のため変更なし。本番は同一ドメイン配信で CORS 不要、localhost 許可は開発用（`json()` に根拠コメントあり）。`Vary: Origin` は許可・拒否の両系で送出済み（`workerHttpContract` で pin）。LAN 検証時の opaque failure はブラウザ仕様であり、サーバー側で開く（allowlist 緩和）のは逆効果のため行わない。
- 修正内容（根本原因のみ・`any`/抑制コメント/スキップなし・契約テストの意図は維持）:
  - M-7・P-7（日英混在）: Worker の user-facing `{ error }` 英文 30 種を発生源で日本語化（protocol 系: 413/400/405/500、domain 系: id/ticker/symbol/basket/sortOrder/ownerToken/asset 等）。原文・仕様の両面で多数派（73 件）だった日本語に寄せ、`readResponseErrorMessage` 経由で UI toast に素通しされていた英文を根絶。共有 validator の `Invalid basket item:*`（U-1 契約・多数 pin）は不変。英文 `error:` リテラル 64→0 件・日本語 73→133 件で混在の解消を確認。
  - M-13: `worker/internal-impl.ts` の `crypto.randomUUID()` 直使用 2 箇所（`pwd-…`・`custom-…`）を共有 `safeRandomId` に統一（`../src/lib/randomId` を import）。`pwd-` は 8hex（32bit）等価、`custom-` は UUIDv4 122bit→128bit hex に強化（`isValidIndexId` 上限 100 文字・charset 内）。非 secure context での `TypeError` 耐性は共有 helper に集約。
  - P-6: `Tutorial3DCanvas` の mount effect が closure の `currentStep/isReducedMotion/isAutoRotatePaused` を読む箇所を `latestPropsRef.current` 経由に置換（mount 時点値は同一のため等価）。`[]` が完全になり `eslint-disable-next-line react-hooks/exhaustive-deps` を除去。更新は既存の専用 sync effect 群が担う。
  - P-8: `todayJstDateString()` の `Intl.DateTimeFormat` 生成をモジュールレベル共有インスタンス化（`format` は副作用なしのため等価）。
  - P-3: `TutorialPage` の global keydown ガードに `SELECT` を追加（`INPUT/TEXTAREA/contentEditable` の兄弟漏れ。`m`/`r`/Space/矢印の横取りで select の type-ahead と競合した根本を解消）。heatmap タイルは `role=button/tabIndex/Enter/Space/aria-label` 完備、他 handler（Cmd+K/Escape/Tab trap）は修飾キー・対象限定済みで変更なし。
  - M-12: 回帰テストで固定（`.gitignore` の `wrangler.local.jsonc` 行・追跡 `wrangler.jsonc` の `__D1_DATABASE_ID__` 維持・実値 32hex 非混入・`deploy.yml` の secret 置換）。実 ID 入りの local ファイル自体は文書化された正規運用のため残置。
- テスト: 新規 9 件＋既存 pin の意図維持更新。`workerHttpContract.test.ts` に `parseJsonBody` 直結 3 件（413/400 の日本語・正常系 pass-through）。`workerApi.test.ts` の id 形式を `^custom-[0-9a-f]{32}$`・`^pwd-\d+-[0-9a-f]{8}$` に厳格化。`localDevConfig.test.ts` 3 件（M-12）。`tutorialKeyboardGuard.test.ts` 2 件（P-3）。`Tutorial3DCanvas.test.ts` に抑制除去 pin 1 件。`reviewRoundFixes.test.ts` に JST 境界 1 件（15:00Z→翌日/14:59:59Z→当日）。英語 pin 16 件（8 ファイル）は日本語等価に更新（strictness 維持: `toBe`→`toBe`、`toContain`→`toContain`）。`comprehensiveAuditFixes` の ID 生成テストは `safeRandomId`＋`not.toContain("crypto.randomUUID")` に更新。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0（warnings 0）、`npm test` 238 files / **2303 passed**、`npm run build` exit 0、`check-first-paint` OK。
- 残: なし（U-1〜U-8 全完了）。

## 15. FINISH 完了記録（2026-10-25）: エラー文言カタログ化

- 対象: 監査で指摘された `worker/internal-impl.ts` の重複 JA リテラル（500 文言の 24× inline 等）。振る舞い変更・新機能なし。
- 修正内容: `RATE_LIMIT_ERROR_MESSAGE` に倣い、user-facing `{ error }` 文言 31 定数＋パラメータ付き 4 関数（`yahooNoDataMessage`・`basketMaxItemsMessage`・`invalidOwnerTokenMessage`・`ownerTokenLengthMessage`・`adminLoginLockoutMessage`）をモジュールカタログ化し、全 call site（U-8 導入分＋既存の管理者/quota 系重複 15 種）を参照に置換。文言は一字も変更せず、共有 validator の `Invalid basket item:*`（U-1 契約）は対象外。`{ error: "…" }`／template 両形式の重複はゼロになったことを grep で確認。
- テスト: 新規 `src/lib/workerErrorMessages.test.ts` 3 件（全カタログ値の逐語 pin＋4 関数の出力 pin）。既存の wire-level pin（16 件）は文言不変のため無修正で全グリーン。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 239 files / **2306 passed**、`npm run build` exit 0、`check-first-paint` OK。

## 16. FINISH 完了記録（2026-10-25）: M-7 後半（CORS/429 切分けの client 側完結）

- 対象: 監査 SPEC 指摘の「LAN CORS の opaque 失敗が cache fallback に黙って沈む」問題。CORS allowlist は不変。
- 修正内容（根本原因・単一所有）: `apiContract.ts` に `NETWORK_UNREACHABLE_MESSAGE`＋`FetchNetworkError`（`cause` 保持）を追加し、`useIndices` の list fetch の transport 部分だけを wrap。`fetch()` の拒否（DNS/切断/refuse/opaque CORS）は status を持たないため発生箇所で marking するのが唯一正確な判別で、メッセージ sniffing は採用せず。outer catch・fallback（cached→DEFAULT）・abort 沈黙化は既存のまま。後段の TypeError（真のバグ）は従来通り独自メッセージを維持。
- テスト: 新規 7 件。`apiContract.test.ts` に 2 件（hint 文言・`cause`・デフォルト）。`useIndices.networkFallback.test.tsx` 5 件（TypeError→hint＋cache 維持／未 cache→DEFAULT＋hint／HTTP 500→従来文言で hint 非混入／非 Error reject→transport 扱い／回復後の hint 消去）。
- 検証: `tsc` app/test 全 exit 0、`npm run lint` exit 0、`npm test` 240 files / **2313 passed**、`npm run build` exit 0。新規 UI クロームなし（既存 `error` 表示に乗る）。

## 17. FINISH 完了記録（2026-10-25）: FetchNetworkError の全パス一般化

- 対象: 監査指摘の残余（保存/削除/銘柄追加・削除・計算パスでの LAN CORS 英語素通し）＋`fetchWithNetworkMark` への集約。allowlist・文言・fallback 不変。
- 修正内容: `apiContract.ts` に `fetchWithNetworkMark(input, init)` を追加（transport のみ wrap、abort は `init.signal.aborted`＋`AbortError` 判定で素通し、`cause` 保持）。`useIndices` の list inline ネストを同 helper に置換（5 mutation: save/delete/add/remove＋list）＋`useCalculation` の calculate fetch に適用。`useSimulation` は catch が既に固定 JA 文言のため変更なし。
- テスト: 新規 7 件。helper 5 件（pass-through・TypeError→hint＋cause・非 Error→wrap・pre-abort signal 素通し・signal なし AbortError 素通し）。hook 2 件（save 失敗→`{ok:false, error: hint}`／calculate 失敗→hint）。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0、`npm test` 240 files / **2320 passed**、`npm run build` exit 0。全 user path で LAN CORS が hint として区別可能。

## 18. FINISH 完了記録（2026-10-25）: ネットワーク失敗テストの共有ハーネス化

- 対象: 監査指摘の triplicated scaffolding（3 ファイル）＋未カバーの 10s タイマー abort パス。production 振る舞い不変。
- 修正内容: `src/test-helpers/networkFailure.ts` を新設（`installFailingFetch`・`installAbortableHangingFetch`・`renderWithFailingFetch`・`expectConnectionHint`）。`useIndices.networkFallback`（7 件）・`useCalculationCoverage` の calculate 失敗試験・`apiContract` の helper 単体試験を同ハーネスに移行し、各ファイルの手書き stub を削除。abort 試験は hanging double＋fake timers で 10s タイマーを発火させ、`AbortError`→沈黙（error null・DEFAULT 維持・loading false）を実証（`window.setTimeout` が fake timers に従うことも兼ねて確認）。
- 検証: `tsc` app/worker/test 全 exit 0、`npm run lint` exit 0（`no-unused-vars` 2 件を rest-args 参照で解消）、`npm test` 240 files / **2321 passed**、`npm run build` exit 0。
