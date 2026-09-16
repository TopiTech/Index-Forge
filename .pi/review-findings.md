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
