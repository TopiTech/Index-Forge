# コードレビュー所見(2026-09-20・goal mu8gslck-b7vqlq)

ベースライン: `npm run build`(tsc app + tsc worker --noEmit + vite build)成功・警告0、`npm run lint` 違反0、`npm test` 66ファイル/617テスト全成功。新規 `src/lib/comprehensiveReviewCurrentRound.test.ts`(8件・行動検証中心)を含む。

## 今回レンジの問題一覧(重要度順)

| ID | 重要度 | 問題 | 対応 |
|----|--------|------|------|
| R1 | P1 High | `src/hooks/useIndices.ts` `saveCustomIndex` がサーバ未確認のcaller-tokenを保存し、管理者が他者指数を編集すると当該ブラウザが「自分の指数」と誤表示する | **修正済み** — `resolvePersistedOwnerToken(data, storedToken)` に一本化。シグネチャにcaller-tokenを持たせない構造で未確認保存を型レベルで不可能化 |
| R2 | P2 Med | `deleteCustomIndex` / `removeStockFromIndex` が ownerToken をURLクエリ(`ownerToken=`)に重複送信し、サーバログ・ブラウザ履歴・分析基盤へ秘密漏洩する | **修正済み** — `buildDeleteIndexRequest` / `buildDeleteStockRequest` でURLはID系のみ・トークンは `x-owner-token` ヘッダーのみに統一 |
| R3 | P2 Med | `SYSTEM_INDICES` が `worker/index.ts` と `src/data/indices.ts` で二重定義され将来乖離する | **修正済み** — worker側リテラルを削除し `SHARED_SYSTEM_INDICES` を再エクスポート。既存import不変・挙動不変 |
| R4 | P2 Med | `three.js`(約563KB)・`recharts`・管理画面等を初回バンドルで全量読込し初回表示が重い | **修正済み** — `src/App.tsx` で5ページ(`TutorialPage`/`AdminDashboard`/`IndexBuilderPage`/`PortfolioPage`/`DisclaimerPage`)を `React.lazy` + `Suspense(<LoadingScreen/>)` 化。build出力で `three-*.js` が初回チャンクから分離されることを確認 |
| R5 | P3 Low | `src/components/TradingViewChartModal.tsx` がウィジェット設定JSONを `script.innerHTML` に代入 | **修正済み** — `script.textContent` 化(同一ファイルの `container.innerHTML=""` は空文字クリアのみで実害なし・残置) |

重大(クリティカル)の認証突破・計算破綻・CSP破綻はなし(PBKDF2 100k回+timingSafeEqual、CSP/HSTS/X-Frame-Options 実在確認)。

## 包括範囲の根拠資料

- **正確性**: `src/lib/indexEngine.ts`(ウェイト正規化・指数計算・欠落補完)、`analytics.ts`、`marketCache.ts`(東証開場時間ベース)、WorkerクォータガードSQLはコード精読で確認(前回goalで node:sqlite 実SQLプローブ済みのため本roundは再掲のみ)。
- **保守性**: R3一元化・R1/R2純粋ビルダー抽出(`withOwnerTokenHeader`/`buildDeleteIndexRequest`/`buildDeleteStockRequest`/`buildSaveIndexRequest`/`resolvePersistedOwnerToken`)で単体検証可能化。リファクタは解決に必要な最小範囲。
- **セキュリティ**: R1/R2対応。Workerは旧クエリ(`?ownerToken=`)/ボディ(`ownerToken`)受付を維持(worker/index.ts L2137・L3244付近の `searchParams.get("ownerToken")` / bodyフォールバック残置)するため旧クライアント互換あり。PBKDF2+timingSafeEqual、レート制限fail-closed、ボディ上限、CSP/HSTS/X-Frame-Options、CORS localhost限定は実在確認。
- **性能**: R4対応。`npm run build` 出力で `three-*.js`(約563KB)/`recharts-*.js`/`TutorialPage-*`/`AdminDashboard-*` 等が別チャンク化されることを確認。初回 `index-*.js` から分離。
- **依存使用法**: `npm audit --omit=dev` = 0件(本番同梱に脆弱性なし)。`npm audit` 全体では dev経路(sharp ← miniflare ← wrangler)の moderate/high 5件を観測。本番バンドルに同梱されない開発専用経路のため対応不要と判断(記録のみ)。
- **仕様整合性**: 公開API・データ形式・DBスキーマ変更なし。Worker互換維持・`SYSTEM_INDICES` 再エクスポートで既存import不変。保存済み指数・所有トークン・認証フロー・D1データへの影響なし。移行措置不要。
- **UI/アクセシビリティ**: ModalBase+useModalFocus(フォーカストラップ・Escape・復帰・スクロールロック・複数モーダルtopmost)、ドロワー(inert+Escape+overflow制御)、ヒートマップ(role=button/tabIndex/keydown/aria-pressed/label)、テーブル(aria-sort/keyboard)、prefers-reduced-motion、1080/768/640/480ブレークポイントはコード精読で維持確認。ただし実ブラウザの視覚・実デバイススクリーンショット検証は未実施(未解決事項に明示)。
- **本番DB/デプロイ判断**: 本変更はスキーマ・API不変のため本番DB操作・デプロイは不要と判断。`wrangler dev`/本番デプロイ・本番DB操作は未実施(Cloudflare認証情報が必要なため)。フル対応方針のもと実施すべき本番操作は発生しなかった。

## 再発防止テスト

- 新規 `src/lib/comprehensiveReviewCurrentRound.test.ts`(8件): `resolvePersistedOwnerToken` の保存解決(サーバエコー/保存値/空文字・不正形)、`buildDeleteIndexRequest` / `buildDeleteStockRequest` / `buildSaveIndexRequest` の実実行(URLにトークン非含有・ヘッダー送信)、`SYSTEM_INDICES` 実値一致(worker vs frontend)、`textContent` 化を行動・実値で直接検証。配線センチネル(`buildSaveIndexRequest(`/`resolvePersistedOwnerToken(`等の含有・`queryParams.set("ownerToken"` 非含有)の文字列検査は最小限のみ。
- `src/lib/codeReviewGoalResolution.test.ts`: 旧「DELETEでownerTokenをURLに含める」肯定テスト(旧106-136行)を、実ビルダー関数を行使するヘッダー限定テストに書換え(矛盾の解消)。
- `src/lib/reviewRegression.test.ts`: 旧文字列assertion(`const responseToken =`)を `resolvePersistedOwnerToken(data, storedToken)` 配線検証に更新。旧脆弱式 `const finalToken = data.ownerToken || token;` の非含有を回帰ガード。

## 未解決・未検証事項

1. 実ブラウザでの視覚確認未実施(レスポンシブ・フォーカストラップ・遅延フォールバックはコード精読のみ)。
2. 実機D1/本番デプロイ未実施(認証情報要・スキーマ/API不変のため不要と判断)。
3. Yahoo Finance 非公式v8 APIの将来仕様変更リスク(タイムアウト・異常系・フォールバック実装済み)。
4. dev経路の `npm audit` 5件(本番非同梱・対応不要として記録のみ)。

---

## 付録: 前回goal(9/16)の所見 — 以下は履歴保存(本roundで追記・上部が現行)

# コードレビュー所見(2026-09-16)

ベースライン: `npm run build` / `npm run lint` / `npm run test`(43ファイル・411テスト)すべて成功。
SQLite意味論の検証は node:sqlite による実行プローブで確認済み(後述の「検証済み」参照)。

## 問題一覧(重要度順)

### 【中】F1. useSimulation がネットワークエラー時に setError(null) で疑似データを無音提示
- 場所: `src/hooks/useSimulation.ts` catch ブロック(L202-206 付近)および `/api/calculate` が空 universe を返した場合(L172-176)
- 内容: fetch 失敗時・APIエラー時に `generateFallbackStockUniverse`(ティッカーハッシュから生成した疑似株価)で系列を作り、**`setError(null)` でエラーを握りつぶす**。SimulationPreview には「リアルタイム・シミュレーション」として擬似バックテストが実データと見分けがつかないまま表示される。
- 影響: ビルダー画面のバックテスト数値(期間リターン・シャープレシオ等)が実データ不在時に偽の値としてユーザーに提示される。投資判断に関わる誤情報リスク。
- 修正方針: エラー状態を UI に伝え、疑似フォールバック系列には明示的な「デモデータ」警告を表示。`error` ステートを保持し SimulationPreview に警告バナーを出す(既存の role="alert" 領域あり)。
- リスク: 低。ゲスト体験(オフラインでも試せる)は維持しつつ警告追加のみ。

### 【中】F2. TradingViewTickerTape がハードコードの静的価格を実データ風に表示
- 場所: `src/components/TradingViewTickerTape.tsx` L18-105(`defaultPrice` / `defaultChangePercent`)
- 内容: ティッカー横断バンドが「日経平均 38,980.50 +0.37%」等の**固定値**を実行情報のように常時表示。実データ取得なし。
- 影響: ダッシュボード最上部に常に偽の市況値が表示される。誤解を招く情報表示。
- 修正方針: 軽微な修正として「参考表示(固定値)」であることを目立たせるラベル追加、または値表示を削除して銘柄名のみに。全面リアルタイム化はスコープ外(Worker/API追加が必要)のため報告のみ。
- リスク: 低。

### 【低】F3. useCalculation の syncedTickersRef と localStorage キャッシュの不整合時の再計算
- 場所: `src/hooks/useCalculation.ts`
- 内容: 同期成功銘柄はインメモリref/localStorageに記録され、`isPriceCacheFresh` で再同期をスキップする。Worker 側 `sync_logs` の負のタイムスタンプ(失敗マーカー)はブラウザに伝わらないため、Yahoo取得失敗直後の5分間、ブラウザは再試行を省略する場合がある。
- ただし Worker の sync-prices は `lastSynced<0` を `status:"failed"` で返し、ブラウザは warnings 表示する。失敗時は syncedTickersRef に記録されないため、**実害は限定的**(ページ再読み込み間は localStorage に記録されない)。
- 判断: 実装済みの負マーカー設計で整合しており修正不要。観察記録のみ。

### 【低】F4. /api/indices GET のインメモリキャッシュがワーカー間で不整合
- 場所: `worker/index.ts` L2214-2280(`memoryCache` 15秒)
- 内容: 書き込み後に `clearMemoryCache("api:indices")` を呼ぶが、これは同一 isolate のみ有効。別 isolate が最大15秒間古い一覧を返す可能性。
- 緩和: クライアントは保存後に `fetchIndices()` を強制再取得し、`localStorage.removeItem(INDICES_ETAG_KEY)` 済み。さらに Cache-Control: no-cache で CDN キャッシュなし。影響は15秒以内の他ユーザー表示遅延のみ。
- 判断: 設計上許容(分散キャッシュ無し構成)。報告のみ。

### 【低】F5. AdminDashboard のユーザー発行パスワード入力が type="text"
- 場所: `src/components/AdminDashboard.tsx` L855付近(`new-user-password`)
- 内容: 発行するパスワードを `type="text"` + monospace で表示する仕様(管理者がコピーするため意図的)。`autoComplete="new-password"` あり。パスワードマネージャーの保存対象になる可能性はあるが管理者操作であり許容。
- 判断: 仕様として妥当。修正不要。

### 【低】F6. ConstituentsTable のヘッダーソート th に role="columnheader" を明示
- 場所: `src/components/ConstituentsTable.tsx`
- 内容: `th` は本来 role 指定不要だが、`tabIndex` + onClick + keydown でインタラクティブ化しており、ボタンでない要素のソートはスクリーンリーダーで「クリック可能」と伝わりにくい。`aria-sort` は実装済みで最低限の情報は伝わる。
- 判断: 改善余地はあるが重大なアクセシビリティ欠落ではない。既存の aria-sort / tabIndex / keydown 実装で実用上問題なし。報告のみ。

### 【低】F7. PerformanceChart / SimulationPreview の recharts 内 id="cyanGradient" が単一ページに複数チャート存在時に衝突する可能性
- 場所: `PerformanceChart.tsx` L361(`id="cyanGradient"`)、`SimulationPreview.tsx`(`id="simColorCustom"`)
- 内容: 2コンポーネントは同時にマウントされない(App ダッシュボード vs ビルダー)。同一IDの別定義が同時に存在しないため実害なし。
- 判断: 修正不要。

### 【情報】検証済み: Worker の SQL クォータガード書き込み
- `prepareIndexUpsert` の `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?` と、既存行更新時の `INSERT OR REPLACE + COALESCE サブクエリ`、`prepareBasketItemWrites` の `WITH incoming ... WHERE EXISTS` ガード、在庫削除の rowid+COUNT DELETE について、node:sqlite で実 SQL を実行し動作を確認:
  - 上限到達時の新規INSERT → 0行(正常)
  - 上限到達時の既存行UPDATE → 0行・既存行保持(正常)
  - 余裕がある場合の既存行UPDATE → creator_id 等が COALESCE で保持される(正常)
  - 期限切れウィンドウの rate_limit リセット構文も妥当
- 並行性に関する以前の懸念は実装済みのアトミックSQLで解消済み。

### 【情報】セキュリティ全般
- PBKDF2(100k回)+レガシーSHA-256移行、タイミング安全比較、レート制限(認証失敗時fail-closed)、ボディサイズ上限、CSP/HSTS/X-Frame-Options 等のヘッダー、CORS はlocalhostのみ、平文パスワード非保存・レスポンス非公開、CSV数式インジェクション対策(escapeCsvCell)、プロトタイプ汚染対策(ownership.ts)など、堅牢な実装。
- 気になった点: `ADMIN_PASSWORD` 環境変数が未設定の場合、初回は admin-master 行が無ければ誰も管理者になれない(READMEどおり secret 設定が前提)。fail-safeであり問題なし。
- `x-admin-key` ヘッダーと `x-auth-password` が同値を運ぶが、Worker側は同一の認証フローであり権限昇格の抜け道なし(role は D1 の行で決まる)。

### 【情報】UI/アクセシビリティ
- モーダル: ModalBase + useModalFocus でフォーカストラップ・Escape・復帰・スクロールロック実装済み。複数モーダルのスタック対応(topmost 判定)済み。
- サイドバードロワー: focus trap + Escape + inert 属性 + body overflow 制御済み。
- ヒートマップ: role="button" + tabIndex + keydown + aria-pressed + aria-label 実装済み。
- テーブルソート: aria-sort + keyboard 対応済み(F6参照)。
- prefers-reduced-motion 対応(CSS L2160 + MotionConfig reducedMotion="user")。
- レスポンシブ: 1080px/768px/640px/480px ブレークポイント、モバイル用ソートUI・カードリスト実装済み。重大なレイアウト崩れのコード上の根拠は確認できず。

## 修正対象の決定
- F1(修正+テスト): エラー時の無音フォールバックに警告を表示
- F2(修正+テスト): ティッカーの静的値を「参考値」であると明示
- F3-F7: 報告のみ(修正不要と判断、根拠は上記)
