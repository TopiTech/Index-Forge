# Round 2 — 包括レビュー修正課題台帳

生成: 2026-10-20 / 対象: `e3db175` + 未コミット作業ツリー
レビュー方式: 8 サブエージェントによる全ファイル完読（インフラ / UI-A / UI-B / フロントロジック / Worker HTTP / Worker データ / テスト品質 / 既存課題再検証）。
本台帳は「フェーズ2で採否を決定した修正課題」の正本であり、フェーズ4の監査はこの ID と差分を1対1で突合する。

## 判定凡例

- `FIX` — 今回のラウンドで実装し、回帰テストと全検証を通す。
- `FIX-PARTIAL` — 実装するが、アーキテクチャ上の制約が残るため残余リスクを明記する。
- `ACCEPTED` — 意図的に受容するリスク。根拠と残余リスクを明記する。
- `DEFER` — 今回のスコープ外。理由を明記する（原則として生産バグではないものに限定）。

## 修正バッチとファイル所有権（コンフリクト防止）

| バッチ | 担当 | 所有ファイル（同時編集禁止） |
|---|---|---|
| A | Backend / Auth | `worker/internal-impl.ts`, `worker/internal.ts`, `worker/index.ts`, `schema.sql`, `schema.migration.sql`, `schema.dev.sql`, `wrangler.jsonc`, `index.html`, `public/reload-suppress.js`（新規）, `src/lib/auth.ts`, `src/hooks/useAuth.ts`, `src/types/index.ts`, `src/components/AuthModal.tsx`, `src/components/AdminDashboard.tsx`, `src/components/EditPasswordModal.tsx` |
| B | Infra / Build / Docs | `package.json`, `tsconfig.worker.json`, `vite.config.ts`, `eslint.config.js`, `.github/workflows/*`, `.gitignore`, `README.md`, `dev-commands.md`, `public/bg-city.png`（削除）, `src/test-helpers/setup.ts`（新規）, `src/lib/schemaContract.test.ts`（新規） |
| C | Client Data / Hooks | `src/lib/marketDataService.ts`, `src/lib/indexEngine.ts`, `src/lib/indexSerialization.ts`, `src/lib/portfolioStorage.ts`, `src/lib/ownership.ts`, `src/lib/syncCache.ts`, `src/lib/marketCache.ts`, `src/lib/searchNormalize.ts`（新規）, `src/data/stockUniverse.ts`, `src/data/indices.ts`, `src/data/macroSchedule.ts`, `src/hooks/useIndices.ts`, `src/hooks/useCalculation.ts`, `src/hooks/useSimulation.ts`, `src/hooks/useBenchmark.ts` |
| D | UI Core / Navigation | `src/App.tsx`, `src/contexts/FreshnessContext.tsx`, `src/components/GlobalSearchModal.tsx`, `src/components/IndexBuilderPage.tsx`, `src/components/IndexBuilderContent.tsx`, `src/components/IndexBuilderModal.tsx`, `src/components/CalendarPage.tsx`, `src/components/BenchmarkSelector.tsx`, `src/components/DataFreshness.tsx`, `src/components/StockTechnicalChart.tsx`, `src/components/ModalBase.tsx`, `src/components/Toast.tsx`, `src/components/Sidebar.tsx`, `src/hooks/useModalFocus.ts` |
| E | UI Data Pages | `src/components/ScreenerPage.tsx`, `src/components/StockAnalysisPage.tsx`, `src/components/StockDetailPage.tsx`, `src/components/PortfolioManagerPage.tsx`, `src/components/PortfolioPage.tsx`, `src/components/MarketOverviewPage.tsx`, `src/components/TradingViewTickerTape.tsx`, `src/components/TradingViewChartModal.tsx`, `src/components/ThemeControls.tsx`, `src/components/RiskMetricsCard.tsx`, `src/components/SimulationPreview.tsx`, `src/components/PerformanceChart.tsx`, `src/components/ThemeHeatmap.tsx` |
| F | CSS / Tokens | `src/index.css`, `src/styles/tokens.css` のみ |
| G | Test Reconciliation | テストファイルと `src/test-helpers/*`（A–F 完了後に直列実行） |

実行順: **A/B/C/D/E/F を並列 → G → フェーズ4監査**。A は API 契約（管理者セッション、`weight`、provenance）を先に確定し、C/D/E は A の契約に合わせる。同一ファイルを2エージェントが編集してはならない。

---

## SEC — セキュリティ / 認証 / 認可

| ID | 重大度 | 元所見 | 判定 | 根本原因と修正方針 |
|---|---|---|---|---|
| SEC-01 | Critical | BEHTTP-1, BEDATA-1 | FIX | 管理者2要素認証がログインUI内でしか検証されず、`x-auth-password` だけで全 `/api/admin/*` とシステム指数変更が可能。`admin_sessions` テーブル（token_hash, account_id, created_at, expires_at）を追加し、`/api/auth/admin-login` 成功時のみ短寿命トークンを発行。`x-admin-session` を必須化し、管理API・システム指数変更・管理者バイパスを `authenticateAdmin()` 経由に統一。`isTestRuntime()` のみパスワードフォールバックを許可（本番では無効）。パスワード/秘密の暗号変更・アカウント削除でセッション失効。ログアウトAPIでセッション削除。 |
| SEC-02 | High | BEHTTP-2, BEDATA-11 | FIX | `/api/auth/verify` が管理者ロールを返し、ロックアウト対象外のパスワードオラクルになっている。`authenticatePassword(..., allowAdmin=false)` を追加し、verify は管理者/master 行を一切評価せず、失敗は常に同一の 401 を返す。`checkAdminLoginLockout` / `recordAdminLoginFailure` は D1 エラー時に fail-closed（503）。`admin_login_attempts` の期限切れ行を rate_limits と同様に purge。 |
| SEC-03 | Medium | BEHTTP-3, BEDATA-12 | FIX | `DELETE /api/indices` と `/api/indices/stock` が `?ownerToken=` を受け付け、永続ログに資格情報が残る。クエリ文字列からのトークン受理を削除（ヘッダ/ボディのみ）。`wrangler.jsonc` の `redact_query_string` を `true` に変更。 |
| SEC-04 | Medium | BEHTTP-4 | FIX | owner token の検証が長さ≤256のみ。新規発行・新規設定トークンは 32文字以上の `[A-Za-z0-9_-]` を必須化。既存の弱いトークンは一致時のみ後方互換で受理し、次回更新時に強トークンへ移行。 |
| SEC-05 | Medium | BEDATA-10 | FIX | アカウント削除時に `indices.owner_token_hash` を残すため、削除済みユーザーのトークンが有効なまま。削除 batch に `UPDATE indices SET owner_token_hash = NULL, owner_token_issued_at = NULL WHERE creator_id = ?` を追加。対象アカウントの `admin_sessions` も削除。 |
| SEC-06 | High | FE-3, REGR-5, R51 | FIX | `sessionStorage` 書込み失敗時に平文パスワードを `localStorage` へ永続化している。フォールバックを「メモリのみ（永続化しない）」に変更し、リロード時は再認証を要求。R51 の緩和記述を実態に合わせて訂正。 |
| SEC-07 | Medium | INFRA-3, BEHTTP-8 | FIX | CSP の `script-src 'unsafe-inline'` を、`index.html` のインラインIIFEを `public/reload-suppress.js` へ外部化して除去。`worker-src 'self' blob:`、`frame-src`/`img-src` の `https://*.tradingview-widget.com` を追加。`style-src 'unsafe-inline'` は維持。 |
| SEC-08 | Low | R52 | FIX | owner token が無期限。`indices.owner_token_issued_at` を追加し、90日超のトークンをサーバー側で 403。クライアントは `{token, issuedAt}` 形式へ移行（旧stringは issuedAt=現在として読替え）、期限切れを prune。 |
| SEC-09 | Low | FE-6, BEDATA-17 | FIX | iCalendar の `UID` が未エスケープで CRLF 注入可能、75オクテット折返しなし。UID を `[A-Za-z0-9._-]` に正規化し、全プロパティを 75 オクテットで折り返す `foldIcsLine()` を追加。 |
| SEC-10 | Low | BEHTTP-13 | FIX | `/api/health` と `/api/auth/turnstile-config` が無制限。health は GET のみに限定し、turnstile-config に in-memory rate limit を追加。 |
| SEC-11 | Medium | BEHTTP-5, BEDATA-2 | FIX-PARTIAL | 未認証 `/api/sync-prices` が 1リクエストで最大30銘柄×複数書込みを発生。ティッカー上限を12へ引き下げ、同期ログの失敗マーカー書込みをやめ in-memory back-off に変更、既存系列の照会を1回の `IN (...)` に集約。D1 日次クォータ（IP+日付で500銘柄）を追加。分散IPでの回避は残余リスクとして記録。 |
| SEC-12 | Low | BEHTTP-6 | FIX-PARTIAL | in-memory rate limiter が FIFO で有効期限を無視。期限切れレコードを優先削除する方式へ変更し、per-isolate 制約をコメントで明記。D1 分散リミッタへの置換はコスト増のため DEFER（残余リスク）。 |
| SEC-13 | Low | BEHTTP-12, BEDATA-19 | FIX | `authCache` のヒットが rate limit を迂回し、パスワード変更後60秒間は他アイソレートで旧パスワードが有効。rate limit をキャッシュ参照より前に移動し、管理APIはセッション認証へ移行することで旧パスワードの管理操作を無効化。 |

## DATA — データ整合性 / 来歴 / ビジネスロジック

| ID | 重大度 | 元所見 | 判定 | 根本原因と修正方針 |
|---|---|---|---|---|
| DATA-01 | Medium | BEDATA-3 | FIX | `readNullableNumber` が `null` を静的アンカー値へ置換し、赤字企業の PER 等を捏造。`null` は `null` のまま保持し、`undefined`/非数値のみ fallback。対象: per/pbr/dividendYield/roe/equityRatio/eps/dps。 |
| DATA-02 | Medium | BEDATA-4 | FIX | ファンダメンタルが一部だけ live のとき、残りが静的アンカー値のまま `isDemoData` なしで返る。live で取得できなかった nullable 指標は `null` にし、`isEstimatedPer`/`perNote` と併せて欠損を明示。 |
| DATA-03 | Medium | BEDATA-5 | FIX | 市場概況が1資産でも取れれば全体を `live`/「リアルタイム」と表示し、合成スパークライン・外挿ブレッドスを実データ扱い。各資産に `stale: true` を付与（prevQuote/既定値使用時）、`dataSource` は live 資産比率で決定、サンプル0件時は breadth を捏造しない。 |
| DATA-04 | Medium | BEDATA-6 | FIX | カレンダーのマクロ・テンプレートイベントが、決算イベントが1件でも取れると `source` なしで返る。`generateUpcomingMacroEvents` 自体が `source:"fallback"` を付与。 |
| DATA-05 | Medium | BEDATA-7 | FIX | Worker が `BOJ/FOMC` 日程とマクロ指標を重複定義し、2027年12月以降イベントが消える。`src/data/macroSchedule.ts` の定数と `getNextScheduledMeetings` を Worker から import して単一ソース化。 |
| DATA-06 | Medium | BEDATA-8 | FIX | 非管理者認証が毎回全アカウントへ PBKDF2 を実行。パスワード一意性が作成/更新で保証されるため、ユーザー結果も `authCache` にキャッシュ（キーはパスワードハッシュ）。 |
| DATA-07 | Medium | BEDATA-9 | FIX | 30銘柄同期で既存系列の SELECT が銘柄数分発生し、D1 の per-invocation クエリ上限を超える。既存系列を1回の `IN (...)` で取得し、書込みを1バッチに集約。上限は12銘柄。 |
| DATA-08 | Low | BEDATA-14 | FIX | `schema.migration.sql` に `idx_rate_limits_window_start` がない。冪等な `CREATE INDEX IF NOT EXISTS` を追加し、parity テストを migration まで拡張。 |
| DATA-09 | Low | BEDATA-15, BEHTTP-10, FE-2 | FIX | `GET /api/indices` が `weight:0` を返し、書込みAPIが拒否する。読み出し時に非正の legacy weight を均等割合の正値へ補正。クライアントの保存経路も `weight:0` を捨てず正規化して保持。 |
| DATA-10 | Low | BEDATA-16 | FIX | fundamentals と screener で配当利回りのスケール解釈が逆。`normalizeDividendYield(raw, source)` に統一。 |
| DATA-11 | Low | BEDATA-18, INFRA-8 | FIX | `ensurePasswordTable` が毎コールドスタートで15 DDL（うち6つ失敗）を実行し、失敗を握り潰す。`PRAGMA table_info` で不足を検出した場合のみ DDL を実行し、DDL 失敗を「既存」と区別してログ・再試行。 |
| DATA-12 | Medium | BEHTTP-7 | FIX | `/api/snapshot` の許可シンボルが4つだけで、UIがベンチマーク扱いする `^DJI/^IXIC/^TOPX/^TOPIXG/^TNX/EURJPY=X/EURUSD=X/CL=F/GC=F` が400になる。`BASELINE_ASSET_QUOTES` の INDEX/FX/COMMODITY/BOND/CRYPTO を許可し、Yahoo 取得へ接続。 |
| DATA-13 | Low | BEHTTP-14 | FIX | `/api/snapshot` だけ `?refresh`/`Cache-Control: no-cache` を無視。他エンドポイントと同じ `forceRefresh` を実装。 |
| DATA-14 | Low | BEHTTP-15 | FIX | エラー形式・言語・メトリクスが不統一。429 を日本語化、`userPasswordsCount` から `admin-master` を除外、`adminUsersCount` の `Math.max(1,…)` を撤廃、`dbStatus` を実クエリ結果から算出。 |
| DATA-15 | Medium | INFRA-4 | FIX | クライアント `DEFAULT_INDICES.nikkei-175` が5銘柄、seed は175銘柄。seed からフォールバック配列を生成して一致させ、`seed.sql` との `(ticker, weight)` 一致テストを追加。 |
| DATA-16 | Low | FE-7 | FIX | `infra-tech` の既定ウェイト合計が90。1件を20へ調整し、全 `DEFAULT_INDICES` の合計100テストを追加。 |
| DATA-17 | Medium | FE-2 | FIX | 保存時に `weight:0` の構成銘柄を `sanitizeBasketForRequest` が黙って削除。正規化して正の重みを割り当て、`dropped` を呼び出し元へ返して通知可能にする。 |
| DATA-18 | Medium | FE-4, REGR-1 | FIX | スクリーナー応答を ticker/price だけで検証し、未検証のまま `stockFundamentalsClientCache` へ格納。共通の `cacheStockFundamentals` で必ず `sanitizeStockFundamentals` を通す。 |
| DATA-19 | Low | FE-6 | FIX | ICS の UID エスケープと折返し（SEC-09 と同一修正）。 |
| DATA-20 | Low | FE-9 | FIX | `/api/snapshot` 応答を型アサーションのみで受理。`normalizeBenchmarkData` で `snapshot.symbol` と `series[]` を検証し、不正時は error/空状態へ。 |
| DATA-21 | Low | FE-10 | FIX | ライブ相場未取得時に静的アンカー価格を `isDemoData` なしで P&L に使用。`live` も保存済み `currentPrice` もない場合は `isDemoData: true` を付与。 |
| DATA-22 | Low | FE-11 | FIX | 計算キャッシュが FIFO で、ヒット時に LRU 更新せず、既存キー再設定時にも無関係なキーを削除。delete→set による LRU へ修正。 |
| DATA-23 | Low | FE-13 | FIX | `addPortfolioPosition`/`addWatchlistTicker` が read-modify-write で他タブの追加を失う。書込み直前に再読出ししてマージし、競合時は再試行。 |
| DATA-24 | Low | FE-14 | FIX | `src/lib/yahooSymbolLegacy.ts` はテスト以外に利用者がいない。削除し、テストの import を正規モジュールへ変更。 |
| DATA-25 | Low | FE-15 | FIX | sync→calculate の契約が2フックで重複し、認証ヘッダの有無も不一致。`src/lib/priceSync.ts` に単一実装を抽出し双方から利用。 |
| DATA-26 | Medium | UIB-2 | FIX | スクリーナーがフォールバック時に `isLive=true` と現在時刻を設定。フォールバック行に `isDemoData` を付与し、`live = rows.some(!isDemoData)` で判定。`isLive` を失敗時に false へ戻す。 |
| DATA-27 | Medium | UIB-3 | FIX | チャートが5点未満やAPI失敗時に80日分の合成履歴を生成し、live と同じ表示。`localSeries` に provenance を持たせ、合成時は「参考値（デモ）」バッジを表示。1点以上はそのまま表示。 |
| DATA-28 | Medium | UIB-6 | FIX | ポートフォリオが全行デモでも LIVE/現在時刻を設定。`stale` を登録し、live 行がある場合のみ時刻更新。 |
| DATA-29 | Low | UIB-10 | FIX | ティッカーテープの ETag を body 検証前に確定し、request identity/abort がない。generation + AbortController を追加し、body 検証後に ETag を確定。 |
| DATA-30 | Low | UIA-10 | FIX | カレンダーのフォールバック応答でも `lastUpdatedAt=now`。非フォールバックイベントがある場合のみ時刻更新。 |

## UI — UI/UX / 状態管理 / アクセシビリティ

| ID | 重大度 | 元所見 | 判定 | 根本原因と修正方針 |
|---|---|---|---|---|
| UI-01 | High | UIA-1 | FIX | `GlobalSearchModal` の `typeof localStorage` が getter 例外を投げ、ストレージ遮断環境でアプリ全体が落ちる。例外安全な共通 `safeLocalStorage()` 経由へ統一。 |
| UI-02 | High | FE-1 | FIX | `portfolioStorage.getLocalStorage` が `"localStorage" in globalThis` の直後に getter を評価し、遮断環境で render 中に throw。getter 全体を try で包み、全読み書きを fallback へ。 |
| UI-03 | Medium | UIA-2 | FIX | 初回 `?index=` ディープリンクが `DEFAULT_INDICES` の段階で「処理済み」になり、URLも上書きされる。`loadingIndices` 中は処理せず、未発見時は `pendingIndexIdRef` に保持。 |
| UI-04 | Medium | UIA-3, UIB-7 | FIX | `globalLatestUpdatedAt` を全ビューのフォールバックに使い、他ページの時刻で LIVE 表示。per-view 解決からグローバルフォールバックを外し、builder の mount 時刻登録を削除。 |
| UI-05 | Medium | UIA-4 | FIX | ネイティブ全画面中は `document.body` への portal（モーダル/トースト）が描画されない。overlay root を `document.fullscreenElement ?? document.body` にし、`fullscreenchange` で再描画。 |
| UI-06 | Medium | UIA-5 | FIX | 管理者ログインのロックアウトを一般ユーザータブにも適用。`adminLockout` と `userLockout` を分離し、タブ別に文言・disabled を制御。 |
| UI-07 | Medium | UIA-6 | FIX | `/api/snapshot` にタイムアウトがなく、`loading` が永久に残る。`AbortSignal.timeout` と明示的エラーを追加。 |
| UI-08 | Low | UIA-7 | FIX | 敗者となった認証試行の `loading` が永久に true。フックインスタンスが所有する requestId を保持し、自分の試行が settle したら必ず解除。 |
| UI-09 | Low | UIA-8, UIA-9 | FIX | 「すべて表示」が4フィルタの1つしか解除せず、MEDIUM ラベルが完全一致。全フィルタを解除し、ラベルを実装に合わせる。 |
| UI-10 | Low | UIA-11, UIB-4, UIB-12 | FIX | 未定義 CSS クラス（badge variants, btn-xs, bold, block, column, ellipsis, text-positive/negative 等）と未定義カスタムプロパティ。`index.css`/`tokens.css` に定義を追加し、CSS contract テストを追加。 |
| UI-11 | Low | UIA-12 | FIX | アクセント/ライトテーマでハードコード cyan/navy が残る。`var(--accent-*)`/`var(--surface-control)` へ置換。 |
| UI-12 | Low | UIA-13 | FIX | 「サイドバー格納」が2つの別パネルを操作。ラベルを「ナビゲーションを格納」「指数一覧を格納」に分離し、両方永続化。 |
| UI-13 | Low | UIA-14 | FIX | AuthModal の `role="tab"` が `aria-controls` で包含フォームを指す。`role="group"` + `aria-pressed` へ変更（または実 tabpanel 化）。 |
| UI-14 | Low | UIA-15 | FIX | ダイアログ連鎖で復帰先が切断され focus が body に落ちる。モジュールレベルで最後の接続済み要素を保持し、全ダイアログ終了時に復帰。 |
| UI-15 | Low | UIA-16, UIB-14 | FIX | `role="button"` カード内に実ボタンがあり、Enter/Space がカードへ伝播。内側ボタンの keydown を停止し、カードの役割を見直す。 |
| UI-16 | Low | UIA-17 | FIX | 管理者パスワード一覧を `Array.isArray` だけで型付け。`sanitizeUserPasswordList` を追加し、非 JSON 応答も安全に処理。 |
| UI-17 | Low | UIA-18 | FIX | AdminDashboard のコピー用タイマーと system-stats 取得が unmount/世代管理なし。ref で timer 所有、AbortController + generation を追加。 |
| UI-18 | Low | UIA-19 | FIX | `crypto.randomUUID()` を無条件使用。`getRandomValues` フォールバックの `safeRandomId()` を追加。 |
| UI-19 | Low | UIA-20 | FIX | 保存中に builder モーダルを閉じると入力が失われる。busy を lift し、保存中の Escape/backdrop close を抑止。 |
| UI-20 | Low | UIA-21 | FIX | ダッシュボードのみ `loadingIndices` で全画面 LoadingScreen。シェルを常時描画し、指数依存領域だけ skeleton。 |
| UI-21 | Low | UIA-22 | FIX | ⌘K の lazy chunk 待ちで fallback が null、二度押しで閉じる。Suspense fallback に軽量シェルを表示し、ロード中は開状態を維持。 |
| UI-22 | High | UIB-1 | FIX | `storage` イベントで `positionsPersistedRef`/watchlist ref を更新せず、次回追加で他タブの保有を上書き。イベント受信時に persisted=true に更新。`key === null` も処理。 |
| UI-23 | Medium | UIB-5 | FIX | 銘柄分析の検索ドロップダウンが `overflow:hidden` の hero card 内でクリップ。hero の装飾だけを clip し、dropdown を portal または `overflow:visible` に。 |
| UI-24 | Medium | UIB-8 | FIX | TradingView フォールバック状態がティッカー変更後も残る。`stock.ticker` 変更時に `tvFallbackActive` 等をリセット。 |
| UI-25 | Low | UIB-9 | FIX | ティッカーホバーでモーダルがフォーカスを奪い body scroll を lock。ホバー起動時は focus/body-lock をスキップ（クリック時のみ modal 挙動）。 |
| UI-26 | Low | UIB-11 | FIX | `.modal-footer` に padding がない。`padding: 14px 20px; border-top` を追加。 |
| UI-27 | Low | UIB-13 | FIX | マクロ資産へ切り替えても FINANCIALS タブ状態が残り、空テーブルを表示。ticker 変更時に CHART へ戻す。 |
| UI-28 | Low | UIB-15 | FIX | 0% を正の色/上矢印で表示。`changeTone(0)` を neutral に統一し、`-0.0%` を `0.0%` に。 |
| UI-29 | Low | UIB-16 | FIX | 空CSV/読取失敗時に input がリセットされず再選択できない。handler 全体を try/finally にし、`reader.onerror` を追加。 |
| UI-30 | Low | UIB-17 | FIX | 市場概況の更新ボタンが loading 中も押せる。`disabled={loading}` + `aria-busy`。 |
| UI-31 | Low | UIB-18 | FIX | 保有変更のたびに全銘柄を再取得し、`useRef(getSavedDimensions())` が毎 render 実行。差分取得と lazy ref 初期化へ。 |
| UI-32 | Low | UIB-19 | FIX | トーストのタイマーが手動閉じ/unmount で解除されず、hover 停止もない。timer Map と pause を実装。 |
| UI-33 | Low | UIB-20 | FIX | テーマタブの roving tabindex/arrow なし、`aria-haspopup` 不一致、デモバナーが `role="alert"`。共有タブ実装へ寄せ、role を修正。 |
| UI-34 | Low | R16, REGR-3 | FIX | unmount abort 後も catch が `setError`/`setIndices` を実行。abort 時は早期 return し、mountedRef を追加。 |
| UI-35 | Low | FE-5 | FIX | メモリ再計算経路で `loading` が false にならない。高速経路と recompute 分岐で解除。 |
| UI-36 | Low | FE-12 | FIX | `useIndices` が他タブの index 変更を購読しない。`storage` イベントで再取得/rehydrate。 |
| UI-37 | Low | FE-8, REGR-2 | FIX | CSV インポートが `createPortfolioPosition` を迂回し id を再実装。ファクトリ経由に統一。 |
| UI-38 | Low | UIA-5 周辺, UI-16 | FIX | 管理系コンポーネントの fetch 応答を安全に parse（非JSON 500 で例外にしない）。 |

## INFRA — ビルド / CI / 設定 / ドキュメント

| ID | 重大度 | 元所見 | 判定 | 根本原因と修正方針 |
|---|---|---|---|---|
| INFRA-01 | Medium | INFRA-1 | FIX | CI が Wrangler 設定/Worker バンドルを検証しない。`wrangler deploy --dry-run --outdir <tmp>` を CI に追加。 |
| INFRA-02 | Medium | INFRA-2 | FIX | `tsconfig.worker.json` が `vite.config.ts` を取り込み Node globals を許可。include から除外し、`process` 参照を `globalThis` 経由へ変更。 |
| INFRA-03 | Medium | INFRA-5 | FIX | README の本番 D1 コマンドに `--config wrangler.local.jsonc` がない。全手動 Wrangler コマンドへ追記。 |
| INFRA-04 | Medium | INFRA-6 | FIX | `db:reset` が remote を破壊。`db:reset` を local、`db:reset:remote` を remote に改名し、reset 後に seed を実行。docs 更新。 |
| INFRA-05 | Medium | INFRA-7 | FIX | schema/クエリを実行するテストがない。`node:sqlite` で `schema.sql` を適用し、テーブル/索引/制約と代表クエリを検証するテストを追加。 |
| INFRA-06 | Low | INFRA-9, BEDATA-13 | FIX | 冗長索引 `idx_basket_items_index_id`（UNIQUE の接頭辞）と `idx_access_passwords_hash`（WHERE 未使用）を削除。migration に DROP を追加。 |
| INFRA-07 | Low | INFRA-10 | FIX | `vitest-report.json` と `.dev.vars.*` が ignore されず、`dev-commands.md` が ignore されている。ignore を修正。 |
| INFRA-08 | Low | INFRA-11 | FIX | 未参照の 815KB `public/bg-city.png` を削除。 |
| INFRA-09 | Low | INFRA-12 | FIX | Vitest に setupFiles がなく DOM cleanup が各ファイル任せ。`src/test-helpers/setup.ts` を追加し RTL cleanup を集約。 |
| INFRA-10 | Low | INFRA-13 | FIX | `eslint .` が warning で失敗しない。`--max-warnings=0` を追加。 |
| INFRA-11 | Low | INFRA-14 | ACCEPTED | `skipLibCheck` が workers-types と WebWorker lib の92衝突を隠す。現時点で実害の証明がなく、型基盤の二重化解消は大規模変更。バージョン整合の注記と定期再生成を文書化。 |
| INFRA-12 | Low | R53 周辺 | DEFER | 55本のレビュー回次テストの統合は大規模churnで生産リスクがない。今回、TEST-01/05/06/08 の実質的欠陥のみ修正し、統合は別ラウンド。 |
| PERF-01 | High | P1 | FIX | `marketDataService` が 4,805行の stockUniverse から純粋な文字列関数を import し、303KB/64KB gzip を初期表示に載せている。`normalizeSearchQuery` を `src/lib/searchNormalize.ts` へ移し、stockUniverse は遅延画面のみに。 |
| PERF-02 | Medium | P2 | FIX | `PerformanceChart`/`ThemeHeatmap` の静的 import で recharts 419KB/113KB gzip が preload。`lazy()` + Suspense へ変更。 |

## TEST — テスト品質

| ID | 重大度 | 元所見 | 判定 | 修正方針 |
|---|---|---|---|---|
| TEST-01 | High | TEST-1 | FIX | 15ファイルの「ローカル再実装をテスト」を、生産モジュールの import へ置換。不可能なものは削除。 |
| TEST-02 | High | TEST-2/3/4 | FIX-PARTIAL | a11y/cleanup/race-guard のソース文字列テストのうち、既に DOM テストが存在する重複を削除。残りは生産リスクの高いものから DOM テストへ変換。全833ブロックの一括変換は DEFER。 |
| TEST-03 | Medium | TEST-5 | FIX | R8/R12/R18/R33/R35/R46 の6件に挙動回帰テストを追加（abort、auth transition、StorageEvent、sync warning、CPI default、error identity）。 |
| TEST-04 | Medium | TEST-6 | FIX | ETag/決算/ローカル設定の条件付きアサーションに前提 `expect(...).toBeTruthy()` を追加。 |
| TEST-05 | Medium | TEST-7 | FIX | 10ファイルの実ネットワーク依存を `fetch` スタブで hermetic 化。共通ヘルパーを追加。 |
| TEST-06 | Medium | TEST-8 | FIX | weight 0→1 の契約変更に合わせ、テスト名とアサーションを一致させる。 |
| TEST-07 | Medium | TEST-11 | FIX | 古いCSVヘッダ・不正日付フィクスチャを現行スキーマ/実日付へ修正。 |
| TEST-08 | Low | TEST-9/10/13/14/15 | FIX-PARTIAL | 自明アサーション・弱いアサーション・Date.now パッチを修正。D1 モックの成功パス side-effect 検証は主要6件に限定。 |
| TEST-09 | Low | TEST-12 | DEFER | 55本の重複レビュー回次ファイル統合は別ラウンド（テスト削減のみで生産コードに影響しないため）。 |
| TEST-10 | High | R53 | FIX-PARTIAL | 85/191ファイルのソース文字列アサーションは、正当な静的契約（schema/CI/CSS/worker entry）と偽の挙動テストに分類済み。偽の挙動テストのうち DOM テストへ未変換のものは、上記 TEST-02 の優先分のみ変換し、残りは残存課題として明記。 |

## 既存台帳の再評価

- R1–R7, R10, R11, R13–R15, R17, R19–R32, R34, R36–R40, R42–R45, R47, R48, R50: **CONFIRMED**
- R8, R9, R12, R16, R18, R33, R35, R41, R46, R49: **PARTIAL** → 本台帳 TEST-03 / DATA-18 / UI-34 / UI-22 / UI-37 / REGR で補完
- R51: **ACCEPTED**（SEC-06 で緩和記述を訂正）
- R52: **FIX**（SEC-08）
- R53: **FIX-PARTIAL**（TEST-01/02/10）
- P1/P2: **FIX**（PERF-01/02）

## 誤検知として除外（再掲・追記）

- `tsconfig.json` の project references / `schema.migration.sql` の非冪等性 / `findPasswordCollision` の上限 / `escapeCsvCell` の負数非加工 / `access_passwords` の索引不足 / portfolio→basket の非100% / SQLインジェクション / SSRF / CSRF / prototype pollution / `env.ASSETS.fetch` 再帰 / cron 未設定 / `x-frame-options` のAPI非付与 は、既存の意図・ガード・設計により誤検知。
- `infra-tech` の seed 合計90はクライアント既定値と一致しており、エンジンが正規化するため計算結果に影響しない（DATA-16 は表示/保存契約の修正として実施）。
- CSP が `index.html` のインラインスクリプトをブロックする、という指摘は誤り（実際は `unsafe-inline` で許可されている）。問題は逆（SEC-07）。
- `bg-city.png` の動的参照、`useAuth` の Worker 型混入、lock file drift、`wrangler` 設定の不正は再検証で否定済み。

## 最終検証コマンド

1. `npm run lint`（`--max-warnings=0`）
2. `tsc -p tsconfig.app.json --noEmit`
3. `tsc -p tsconfig.worker.json --noEmit`
4. `tsc -p tsconfig.test.json --noEmit`
5. `npm test`（全ファイル、skip/only なし）
6. `npm run build`
7. `npx wrangler deploy --dry-run --config wrangler.jsonc --outdir <scratch>`
8. `npm run check:first-paint`（初期転送予算ゲート）
9. フェーズ4の独立監査（台帳突合・`git diff` 再レビュー）

---

# 実施状況（Round 2 / 2026-10-20 完了時点）

判定: `FIX` = 実装＋回帰テスト済み / `FIX-PARTIAL` = 実装済みだが構造的制約が残る / `ACCEPTED` = 受容（根拠明記） / `DEFER` = スコープ外（理由明記）。

## SEC — セキュリティ / 認証 / 認可

| ID | 判定 | 実装の要点と証拠 |
|---|---|---|
| SEC-01 | FIX | `admin_sessions` テーブル（schema.sql / migration / ランタイムプロビジョナ）、`createAdminSession` / `authenticateAdminSession` / `authenticateAdmin` / `revoke*`（`worker/internal-impl.ts`）。全 `/api/admin/*` とシステム指数操作が `x-admin-session` を要求（`adminAuthFailureResponse`）。パスワード変更・秘密の暗号変更・アカウント削除でセッション失効。`POST /api/auth/logout` 追加。クライアントは `AuthSession.adminToken` を保持し `x-admin-session` を送信（`src/lib/auth.ts`, `src/hooks/useAuth.ts`）。テスト: `src/lib/round2AuthClient.test.ts` |
| SEC-02 | FIX | `authenticatePassword(..., allowAdmin=false)`。`/api/auth/verify` は master/管理者行を評価せず、常に同一の 401。`checkAdminLoginLockout` / `recordAdminLoginFailure` は D1 障害時に fail-closed（503）。`admin_login_attempts` の purge 追加。テスト: `generalUserAdminLoginPrevention.test.ts`（管理者PWは401・未知PWと同一応答）、`workerApi.test.ts` |
| SEC-03 | FIX | `?ownerToken=` の受理を削除（ヘッダ/ボディのみ）。`wrangler.jsonc` の `redact_query_string: true`。テスト: `comprehensiveProjectReviewFixes.test.ts`（クエリ指定は拒否） |
| SEC-04 | FIX | `OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/`。新規/設定時のトークンに必須、既存は後方互換で照合のみ許可 |
| SEC-05 | FIX | アカウント削除バッチで `owner_token_hash` / `owner_token_issued_at` を NULL 化＋`admin_sessions` 削除 |
| SEC-06 | FIX | `storeAuth` は `localStorage` へフォールバックせず、メモリ内セッションのみで継続（`src/lib/auth.ts`）。R51 の緩和記述も実態に合わせて訂正 |
| SEC-07 | FIX | `index.html` のインラインIIFEを `public/reload-suppress.js` へ外部化。CSP から `script-src` の `'unsafe-inline'` を除去し `worker-src 'self' blob:` と `https://*.tradingview-widget.com` を追加。テスト: `adminLoginSecurity.test.ts` |
| SEC-08 | FIX | `indices.owner_token_issued_at`（schema/migration/provisioner）＋サーバー側90日失効（`isOwnerTokenExpired`）＋クライアントの `{token, issuedAt}` ストア（`src/lib/ownership.ts`）。**発行日不明（NULL）の既存行は祖父化して有効**（監査A-1 の Critical を反映し、migration とランタイムプロビジョナが発行日をバックフィル）。テスト: `comprehensiveReviewFixes.test.ts`（期限切れトークンは403）、`round2OwnerTokenLegacy.test.ts`（NULL 行の所有者は更新できる） |
| SEC-09 | FIX | `sanitizeIcsUid` / `foldIcsLine` を追加し UID を `[A-Za-z0-9._-]` に制限、75オクテット折返しを実装（`src/lib/marketDataService.ts`）。テスト: `src/lib/round2IcsExport.test.ts` |
| SEC-10 | FIX | `/api/health` は GET のみ（他は405 + `Allow`）、`/api/auth/turnstile-config` に in-memory リミッタ |
| SEC-11 | FIX-PARTIAL | 1リクエスト12銘柄へ縮小、`sync_quota` によるIP×日次5,000銘柄クォータ（429。**実際に取得する銘柄のみ**を課金／監査A-5 で修正）、既存系列の一括 `IN (...)` 取得、失敗バックオフをin-memory化（`sync_logs` への負値書き込みを廃止）。残余: 分散IPでの回避と per-isolate のバックオフ |
| SEC-12 | FIX-PARTIAL | in-memory リミッタの退避を期限優先に変更。残余: 分散キャッシュ（KV/DO）化は未実施 |
| SEC-13 | FIX | レート制限を auth キャッシュ読取より前へ移動。管理操作はセッション認証へ移行し、キャッシュ命中でのリミッタ迂回を解消 |

## DATA — データ整合性 / 来歴 / ビジネスロジック

| ID | 判定 | 実装の要点と証拠 |
|---|---|---|
| DATA-01 | FIX | `readNullableNumber` が明示 `null` を保持（fallback は undefined/不正型のみ）。対象7指標 |
| DATA-02 | FIX | Worker はライブ価格取得時にアンカー値を破棄し、未取得指標を `null` で返す |
| DATA-03 | FIX | 市場概況に資産別 `stale`、ブレッドス捏造の撤廃、`dataSource: live/mixed/fallback` |
| DATA-04 | FIX | `generateUpcomingMacroEvents` が生成時点で `source:"fallback"` を付与 |
| DATA-05 | FIX | Worker が `src/data/macroSchedule` の日程・既定値を import（二重定義を削除） |
| DATA-06 | FIX | 一般ユーザーの認証結果も `authCache` に缓存（パスワード一意性が保証される前提を明記） |
| DATA-07 | FIX | 同期の既存系列取得を1回の `IN (...)` に集約、12銘柄上限 |
| DATA-08 | FIX | `schema.migration.sql` に `idx_rate_limits_window_start` を追加（冪等） |
| DATA-09 | FIX | `GET /api/indices` の非正 weight を `1` へ補正（書込みAPIと整合） |
| DATA-10 | FIX | `normalizeDividendYield(raw, scale)` で2経路のスケールを統一 |
| DATA-11 | FIX | `ensurePasswordTable` を `sqlite_master` / `PRAGMA table_info` プローブ方式へ（必要なDDLのみ実行、失敗は記録して再試行） |
| DATA-12 | FIX | `BENCHMARK_MAP` を `BASELINE_ASSET_QUOTES` から生成し UI が扱うベンチマーク記号を全許可 |
| DATA-13 | FIX | `/api/snapshot` に `?refresh=1` / no-cache 対応 |
| DATA-14 | FIX | 429日本語化、`userPasswordsCount` から master を除外、`dbStatus` を実クエリ結果から算出 |
| DATA-15 | FIX | `NIKKEI_175_BASKET`（175銘柄）へ置換し `seed.sql` と一致 |
| DATA-16 | FIX | `infra-tech` の合計を100へ是正（10→20） |
| DATA-17 | FIX | 保存経路が weight 0 を削除せず正の重みへ正規化 |
| DATA-18 | FIX | `cacheStockFundamentals` 単一入口で常にサニタイズ（スクリーナー経路も含む） |
| DATA-19 | FIX | ICS の UID エスケープと折返し（SEC-09 と同一） |
| DATA-20 | FIX | `normalizeBenchmarkData` による検証（snapshot/series）＋12秒タイムアウト |
| DATA-21 | FIX | ライブ/do行情が無い，行は `isDemoData: true` |
| DATA-22 | FIX | 計算キャッシュを LRU（delete+set）へ |
| DATA-23 | FIX | 追加は直前に再読出し＋id/ティッカーでマージし1回再試行 |
| DATA-24 | FIX | `src/lib/yahooSymbolLegacy.ts` を削除 |
| DATA-25 | FIX | `src/lib/priceSync.ts` に同期契約を一本化し両フックが利用 |
| DATA-26 | FIX | スクリーナーのフォールバック行を `isDemoData` で識別し LIVE 判定に反映 |
| DATA-27 | FIX | チャートに `localSeriesIsSynthetic` を導入し「参考値（デモ）」バッジを表示、1点以上の実系列は合成せず表示 |
| DATA-28 | FIX | ポートフォリオの `stale` 登録と、ライブ取得時のみ時刻更新 |
| DATA-29 | FIX | ティッカーテープに request generation + AbortController、ETag は本文検証後に確定 |
| DATA-30 | FIX | カレンダーは非フォールバックイベントがある場合のみ時刻更新 |

## UI — UI/UX / 状態管理 / アクセシビリティ

| ID | 判定 | 実装の要点と証拠 |
|---|---|---|
| UI-01 | FIX | `GlobalSearchModal` を例外安全なストレージ取得へ統一 |
| UI-02 | FIX | `portfolioStorage.getLocalStorage` を try で囲み、遮断時も縮退 |
| UI-03 | FIX | `?index=` ディープリンクを保留し、取得完了後に選択。読込中の URL 上書きを停止 |
| UI-04 | FIX | per-view 解決から `globalLatestUpdatedAt` を除外、builder の mount 時刻登録を削除 |
| UI-05 | FIX | `getOverlayRoot()`（fullscreenElement ?? body）を ModalBase/GlobalSearchModal/Toast で使用 |
| UI-06 | FIX | 管理者ロックアウトを admin モードのみに適用（`adminLockout`） |
| UI-07 | FIX | `useBenchmark` に12秒タイムアウトとエラー表示 |
| UI-08 | FIX | フックインスタンスが自分の requestId を保持し、resolve 時に必ず loading を解除 |
| UI-09 | FIX | 「すべて表示」で4フィルタを解除、MEDIUM は完全一致の表記に修正 |
| UI-10 | FIX | 不足クラス/トークンを `index.css` / `tokens.css` に定義（badge variants, btn-xs, column, ellipsis, text-positive 等） |
| UI-11 | FIX | ハードコード色を `color-mix(in srgb, var(--accent-color) …)` へ置換（117箇所） |
| UI-12 | FIX | 折りたたみ操作のラベルを分離（「ナビゲーションを格納」/「指数一覧を格納」） |
| UI-13 | FIX | AuthModal のタブを `role="group"` + `aria-pressed` へ変更 |
| UI-14 | FIX | `useModalFocus` が連鎖ダイアログをまたいで復帰対象を保持 |
| UI-15 | FIX | `StockAnalysisPage` の内側ボタンの keydown 伝播を停止 |
| UI-16 | FIX | `sanitizeUserPasswordList` による管理员パスワード一覧の検証 |
| UI-17 | FIX | AdminDashboard のコピタイマー所有と system-stats の AbortController + request generation |
| UI-18 | FIX | `safeRandomId`（`getRandomValues` フォールバック） |
| UI-19 | FIX | builder モーダルの保存中のクローズ抑止（`isSaving` を dialog へ lift） |
| UI-20 | FIX | ダッシュボードはシェルを描画し、指数領域のみ skeleton 表示 |
| UI-21 | FIX | グローバル検索の Suspense フォールバックと読込中の開閉維持 |
| UI-22 | FIX | `storage` イベントで persisted フラグを同期し、`key === null` も処理（他タブの保有を破壊しない） |
| UI-23 | FIX | 検索ドロップダウンが hero card にクリップされないよう CSS とマークアップを修正 |
| UI-24 | FIX | ティッカー変更時に TradingView フォールバック状態をリセット |
| UI-25 | FIX | ホバー起動のプレビューは focus/body-lock をスキップ（`focusOnOpen`/`lockScroll`） |
| UI-26 | FIX | `.modal-footer` に padding と上罫を追加 |
| UI-27 | FIX | マクロ資産切替時にタブを CHART へ戻す |
| UI-28 | FIX | 0 値は neutral（`changeTone`）に統一、`-0.0%` を解消 |
| UI-29 | FIX | CSV 取り込みは常に input をリセットし `reader.onerror` を追加 |
| UI-30 | FIX | 市場概況の更新ボタンを `disabled={loading}` に |
| UI-31 | FIX | ポートフォリオは差分取得、`useRef` の初期化を遅延化 |
| UI-32 | FIX | トーストのタイマー所有・hover/focus での一時停止・片方の politeness に統一 |
| UI-33 | FIX | テーマタブに roving tabindex/矢印キー、`aria-haspopup` を除去、デモデータバナーは `role="note"` |
| UI-34 | FIX | `useIndices` の abort/unmount 時は状態更新せず早期 return |
| UI-35 | FIX | `useSimulation` の高速再計算経路で `loading` を解除 |
| UI-36 | FIX | `useIndices` に `storage` 購読を追加 |
| UI-37 | FIX | CSV 取り込みも `createPortfolioPosition` 経由で id 生成を一本化 |
| UI-38 | FIX | 管理/ポートフォリオの取得で非JSON本文を安全に扱い日本語メッセージを提示 |

## INFRA / PERF

| ID | 判定 | 実装の要点と証拠 |
|---|---|---|
| INFRA-01 | FIX | CI に `wrangler deploy --dry-run` ステップを追加（.github/workflows/ci.yml） |
| INFRA-02 | FIX | `tsconfig.worker.json` から `vite.config.ts` を除外（Node globals 0件）、`isTestRuntime` は globalThis 経由 |
| INFRA-03 | FIX | README の手動 Wrangler コマンドに `--config wrangler.local.jsonc` を明記 |
| INFRA-04 | FIX | `db:reset` を local に、`db:reset:remote` を破壊的版として分離（seed 実行込み） |
| INFRA-05 | FIX | `src/lib/schemaContract.test.ts`（node:sqlite で schema.sql を適用し 12テーブル・索引・制約・代表クエリを検証） |
| INFRA-06 | FIX | 冗長索引 `idx_basket_items_index_id` / `idx_access_passwords_hash` を削除、migration に DROP を追加 |
| INFRA-07 | FIX | `.gitignore` に `vitest-report*.json` / `.dev.vars.*` を追加し `dev-commands.md` を ignore 対象から外す |
| INFRA-08 | FIX | 未参照の `public/bg-city.png`（815KB）を削除 |
| INFRA-09 | FIX | `src/test-helpers/setup.ts` を追加し RTL cleanup を集約（`test.setupFiles`） |
| INFRA-10 | FIX | `lint` を `eslint . --max-warnings=0` に |
| INFRA-11 | ACCEPTED | `@cloudflare/workers-types` と `worker-configuration.d.ts` の二重型定義は `skipLibCheck` で隠れる。実害の証明が無く型基盤の作り直しは本ラウンドのスコープ外。`wrangler types` の定期再生成で運用する |
| INFRA-12 | DEFER | 55本の重複レビュー回次テストの統合は別ラウンド（生産コードに影響しない整理作業） |
| PERF-01 | FIX | `marketDataService` は `popularStocksData` のみを import。データセットは遅延ルート（`AddStockModal` も遅延化）に隔離され、entry から静的に到達不能 |
| PERF-02 | FIX | `PerformanceChart` / `ThemeHeatmap` を `lazy()` 化。CSP・chart ライブラリは entry から到達不能。`scripts/check-first-paint.mjs` が初期転送予算（raw 900KB / gzip 250KB / 単一チャンク 200KB）を CI で強制 |

## TEST

| ID | 判定 | 実装の要点と証拠 |
|---|---|---|
| TEST-01 | FIX | 15ファイルの「ローカル再実装をテスト」を生産 export へ再ポイント（例: `EditPasswordModal` のクォータクランプ、`ConstituentsTable` の所有者判定、`AddStockModal` の重み検証、`ThemeHeatmap` のキーボード操作、`StockTechnicalChart` の `formatTechnicalTooltipValue` / `computeSma`、`ScreenerPage` の `buildScreenerCsvRows`、`TradingViewTickerTape` の `resolveLiveQuotes`、`SimulationPreview` の `buildSimulationChartData`、`useIndices` の `resolveSelectedIndex`） |
| TEST-02 | FIX-PARTIAL | 偽の挙動テストのうち優先度高のもの（useBenchmark の abort/cache、AdminDashboard の abort ガード、AuthModal タブ、App ルート優先度、カレンダー空状態、サイドバーラベル、SimulationPreview ゼロ表示）を DOM/挙動テストへ変換。残存は「ソース文字列だが正当な静的契約」および低リスクの残存 |
| TEST-03 | FIX | R8/R12/R18/R33/R35/R46 の挙動回帰テストを追加（`round2BenchmarkSessionCache.test.tsx`, `round2PortfolioManagerStorage.test.tsx`, `round2UseSimulationRequestIdentity.test.tsx`, `round2MacroCalendarDefaults.test.ts`） |
| TEST-04 | FIX | 条件付きアサーションに前提 `toBeDefined()` を追加（`workerApi.test.ts` の ETag、財務系テストの銘柄存在、`regression.test.ts` のローカル設定） |
| TEST-05 | FIX | 実ネットワーク依存 10ファイル前後を `vi.stubGlobal("fetch", …)` で hermetic 化（`afterEach` で `vi.unstubAllGlobals()`） |
| TEST-06 | FIX | weight 補正のテスト名とアサーションを実装（1）へ一致 |
| TEST-07 | FIX | 旧CSVヘッダのフィクスチャを生産シリアライザの往復へ置換、不正日付を実日付へ |
| TEST-08 | FIX-PARTIAL | 自明アサーションを型/挙動アサーションへ、`Date.now` パッチを fake timers へ、`any` を documented boundary 之外から除去 |
| TEST-09 | DEFER | 55本の重複ファイル統合は別ラウンド |
| TEST-10 | FIX-PARTIAL | ソース文字列アサーションは正当な静的契約（schema/CI/CSS/worker entry/設定）と偽の挙動テストに分類。偽の挙動テストの優先分は TEST-02 で変換。**残存は 202 ファイル中 80 ファイル**（実測。監査A-10 で過小評価が指摘され補正。認証系3ファイル・数値/データ整合系3ファイルは本ラウンドで挙動テストへ変換済み）。残存分の整理は別ラウンドの主題 |

## 測定値（Round 2 完了時点）

| 項目 | 修正前 | 修正後 |
|---|---:|---:|
| 初期表示の合計転送（raw） | 1,536,808 B | 774,598 B |
| 初期表示の合計転送（gzip） | 406,641 B | 216,811 B |
| entry チャンク | 505,925 B | 458,823 B |
| preload 対象 | motion / recharts / lucide / stock-universe | motion / lucide のみ |
| Worker バンドル | 814.98 KiB / 133.49 KiB gzip | 867.71 KiB / 142.23 KiB gzip（+52.7 KiB: セッション・来歴・同期防御の追加。アップロード上限の1%未満） |
| テスト | 191 files / 1,773 tests | 202 files / 1,909 tests |
| lint | warning 許容 | `--max-warnings=0`（0件） |

---

# フェーズ4: 独立監査の結果と是正

Round 2 の修正後、**新規の独立監査エージェント2名**（修正関与なし・台帳突合／差分再レビュー突合 と クリーン性／テスト品質）を起動しました。監査Aは全IDを突合して 12 件の所見（うち Critical 1 / High 1）を報告しました。監査Bは実行環境エラーで上限に達したため、クリーン性・境界整合・ソース文字列テストの計数などの残りを本エージェントが実測しました。

## 監査Aの所見と是正（すべて反映済み）

| 所見 | 重大度 | 内容 | 是正 |
|---|---|---|---|
| AUDIT-A-1 | Critical | `owner_token_issued_at` が NULL の既存指数の所有者が、期限切れ扱い（403）で全員ロックアウトされていた | `isOwnerTokenExpired(null)` を「発行日不明＝祖父化（有効）」に変更し、migration とランタイムプロビジョナが発行日をバックフィル。Worker レベルの回帰テスト `round2OwnerTokenLegacy.test.ts`（NULL 行での更新が 200）を追加 |
| AUDIT-A-2 | High | `portfolioStorage.getLocalStorage()` が getter を try の外で読み、ストレージ遮断時に描画時に例外でアプリ全体が落ちる | `src/lib/auth.ts` と同じ try 付き取得へ統一。`round2ClientResilience.test.ts` で遮断 getter 下の無抛出を検証 |
| AUDIT-A-3 | Medium | `safeRandomId()` が台帳に書かれただけで未実装（`crypto.randomUUID()` 無条件使用） | `src/lib/randomId.ts` を実装し `useIndices` / `IndexBuilderContent` で使用。`randomUUID` 不在時も 48 文字の owner token を生成することを検証 |
| AUDIT-A-4 | Medium | `wrangler.jsonc` の `redact_query_string` が `false` のまま | `true` に変更 |
| AUDIT-A-5 | Medium | 日次同期クォータが「実際に取得しない銘柄」에도課金され、175銘柄の既定指数で数回で枯渇 | 課金を作業対象（`toFetch`）の AFTER に移動し、日次上限を 5,000 銘柄へ。キャッシュ済み銘柄が予算を消費しないことを `workerBugs.test.ts` で検証 |
| AUDIT-A-6 | Medium | 本番モードの管理者ゲート（パスワード単独では不可）の回帰テストが存在せず、コード注釈だけが約束していた | `round2AdminSessionGate.test.ts` を追加（フォールバック無効時の 403／有効セッション時の 200／未知トークンの拒否） |
| AUDIT-A-7 | Low | 8時間で失効する管理者セッションの復帰導線がなく、管理画面がGenericエラーで停止 | `clearAdminSession()` を追加し、403 時にトークンを破棄して「有効期限が切れました。再度ログインしてください。」を提示（`reportAdminFailure`） |
| AUDIT-A-8 | Low | `seed.sql` との一致テストが台帳記載のみで未作成 | `round2IndicesData.test.ts` を作成（175件の完全一致・重み合計100・全既定指数の合計100） |
| AUDIT-A-9 | Low | 初期転送ゲートが entry チャンクを検査せず、recharts を entry に戻しても CI を通過した | entry チャンク単体予算（raw 520KB / gzip 160KB）を追加 |
| AUDIT-A-10 | Low | R53 の残存（ソース文字列アサーション）の件数が台帳で過小評価されていた | 件数を実測（202ファイル中84ファイル）して台帳へ明記 |
| AUDIT-A-11 | Low | CSV 取り込みに `reader.onerror` が無く、読み取り失敗時に同じファイルが再選択できない | `onerror` を追加し、入力欄のリセットを全経路で実行 |
| AUDIT-A-12 | Low | 管理セッション確認が毎要求 D1 書き込みを消費し、429 のメッセージも認証失敗の文だった | `admin-session` を in-memory リミッタへ移設（上限120/分）し、メッセージを「管理操作が多すぎます」に変更 |

## 本エージェントによる実測（クリーン性・境界整合）

| 項目 | 結果 |
|---|---|
| 未追跡ファイル | 意図的な新規のみ（`plans/round2-remediation-ledger.md`, `public/reload-suppress.js`, `scripts/check-first-paint.mjs`, 新規 lib/hooks/test 12件）。`dev-commands.md` は .gitignore 修正により追跡対象として再出現 |
| `console.log` / `debugger`（本番コード） | 0 件 |
| `as any` / `: any`（本番コード） | 0 件 |
| `it.only` / `.skip` / `it.todo` / `@ts-ignore` / `@ts-nocheck` / `eslint-disable`（本番コード） | 0 件（`react-hooks/exhaustive-deps` の disable 2件は本ラウンド前から存在し差分なし） |
| クライアント→Worker の API 境界 | クライアント使用の 19 パスすべて Worker に存在（未使用の Worker パス 4件は残置可） |
| ソース文字列アサーション | 202 テストファイル中 80 ファイル（TEST-10 の残存。LEGITIMATE な静的契約と偽の挙動テストが混在。残存分は別ラウンドの整理対象） |
| 重複した本番ロジック | なし（同期処理は `src/lib/priceSync.ts` に一本化、所有者トークンは `src/lib/ownership.ts`、検索正規化は `src/lib/searchNormalize.ts`） |

