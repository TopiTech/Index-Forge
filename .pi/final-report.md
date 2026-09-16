# IndexForge コードレビュー最終報告(2026-09-16)

## 1. 調査範囲

- **バックエンド**: `worker/index.ts`(3,531行・全APIエンドポイント: 認証/管理/指数CRUD/銘柄同期/計算/スナップショット/レート制限/静的配信とセキュリティヘッダー)
- **計算ロジック**: `src/lib/indexEngine.ts`(ウェイト正規化・指数計算・欠落データ補完)、`src/lib/analytics.ts`(リスク指標・SMA・銘柄詳細)、`src/lib/marketCache.ts`(東証開場時間ベースのキャッシュ)、`src/lib/treemap.ts`、`src/lib/csv.ts`、`src/lib/navigation.ts`、`src/lib/auth.ts`、`src/lib/ownership.ts`、`src/lib/downloadFileName.ts`、`src/lib/yahooSymbol.ts`
- **フロントエンド**: `src/App.tsx`、全hooks(useAuth/useIndices/useCalculation/useSimulation/useBenchmark)、主要コンポーネント全般(Header/AdminDashboard 1,685行/ConstituentsTable 972行/IndexBuilderContent 935行/PerformanceChart 770行/TradingViewChartModal・TickerTape/SimulationPreview/ThemeHeatmap/モーダル群/IndexSelector/Portfolio/Disclaimer/Footer/ui)
- **DB/設定**: `schema.sql`/`schema.migration.sql`/`schema.dev.sql`/`seed.sql`、`wrangler.jsonc`、`vite.config.ts`、`tsconfig.*`、`index.html`、`public/asset-error-recovery.js`
- **検証手段**: 上記の手動精読に加え、Workerの書き込みSQL(クォータガード付きINSERT ... SELECT/INSERT OR REPLACE+COALESCE/WITH incoming+EXISTS ガード/rowid+COUNT DELETE/レート制限のアトミックUPSERT)について node:sqlite で実SQLを実行して動作を検証。

## 2. 発見した問題と重要度

| ID | 重要度 | 問題 | 修正 |
|----|--------|------|------|
| F1 | 中 | `useSimulation` がAPI障害時・空レスポンス時に疑似デモ株価へ無音切替し `setError(null)` で隠蔽 → 実データと見分けがつかない偽のバックテスト数値を提示 | **修正済み** |
| F2 | 中 | `TradingViewTickerTape` がハードコードの固定価格を実行情報風に常時表示 | **修正済み** |
| F3 | 低 | 同期失敗マーカー(負のタイムスタンプ)がブラウザキャッシュに伝播しない | 修正不要(Workerが`status:"failed"`を返し失敗銘柄はキャッシュされないため実害限定的。観察記録) |
| F4 | 低 | `/api/indices` のisolate内メモリキャッシュ(15秒)がワーカー間で不整合になり得る | 修正不要(書込後にclear+クライアント強制再取得+CDNキャッシュ無効化で緩和済み。分散キャッシュ無し構成で設計上許容) |
| F5 | 低 | 管理画面の発行パスワード入力が `type="text"` | 修正不要(管理者がコピーする意図的仕様。autoComplete="new-password"済み) |
| F6 | 低 | 構成銘柄テーブルのソートthがbuttonでなくクリック可能要素 | 修正不要(aria-sort + tabIndex + keydown実装済みで実用上問題なし) |
| F7 | 低 | recharts gradient定義IDの重複可能性 | 修正不要(2チャートは同時マウントされないため実害なし) |

重大(クリティカル)/高の問題は発見されませんでした。

## 3. 変更内容と判断理由

### F1: デモデータの無音提示を解消
- `src/hooks/useSimulation.ts`: `usingDemoData` 状態を新設し、(a) APIが空universeを返した場合、(b) fetch失敗時のフォールバック生成時にフラグを立てる。ネットワークエラー時は「サーバーに接続できないため、デモデータで表示しています。数値は参考値です」をerrorとして通知。
- `src/components/SimulationPreview.tsx`: `usingDemoData && !error` のとき「⚠️ 実データを取得できなかったため、デモデータで表示しています。数値は参考値です」の role="status" バナーを追加。
- 判断理由: 投資判断に関わる数値を偽の実データとして提示するリスクを、ゲストのオフライン試用体験を維持したまま解消。エラー時とデモデータ時で通知を分け、二重表示を回避。

### F2: 参考値であることの明示
- `src/components/TradingViewTickerTape.tsx`: 価格表示に title(「参考値(固定表示)です。最新価格はTradingViewチャートで確認できます」)を付与、バー全体のaria-labelにも「参考値」を追記。
- `src/index.css`: `.tv-ticker-price` を低調化(opacity 0.75)し、`::after` で「(参考)」サフィックス表示。
- 判断理由: リアルタイム化はAPI追加を要するため本件スコープ外と判断し、誤解を招かない表示に最小変更。

## 4. 互換性への影響

- 公開API・データ形式・DBスキーマの変更は **なし**。
- `SimulationResult` 型に `usingDemoData?: boolean` 相当のプロパティを追加(追加のみで既存フィールド不変)。既存の呼び出し元(IndexBuilderContent)は分割代入で影響なし。
- CSSは新規ルール追加のみで既存セレクタの破壊的変更なし。
- 保存済み指数・所有トークン・認証フロー・D1データへの影響なし。移行措置は不要。

## 5. テスト結果

| 検証 | 結果 |
|------|------|
| `npm run build`(tsc app + tsc worker --noEmit + vite build) | ✅ 成功・警告0 |
| `npm run lint`(eslint .) | ✅ 違反0 |
| `npm test`(vitest run) | ✅ 45ファイル / 416テスト全成功(修正前 43/411 → +2ファイル/+5テスト) |

追加テスト(再発防止):
- `src/hooks/useSimulation.demoData.test.ts`: フォールバックuniverseが全銘柄の系列を生成すること、同一ティッカーで決定的であること、デモフラグ型契約の回帰センチネル。
- `src/components/tradingViewTickerReference.test.ts`: ティッカーの静的参考値の存在(開示が必要な理由の固定化)と符号フラグ整合。

## 6. 未解決・未検証事項

1. **実ブラウザでの視覚確認未実施**: レスポンシブ表示・操作はコード精読(1080/768/640/480pxブレークポイント、フォーカストラップ、inert、aria属性)で確認したが、実デバイスでのスクリーンショット検証は行っていない。
2. **TradingView ティッカーのライブデータ化**: 固定値からの置き換えにはリアルタイム行情報ソース(TradingView APIまたはWorker経由の取得)が必要。スコープ外として報告のみ。
3. **実機D1/本番デプロイでの動作**: `wrangler dev` / 本番デプロイでの結合検証は未実施(Cloudflare認証情報が必要なため)。Workerロジックはユニットテスト(411+)とnode:sqliteプローブで検証済み。
4. **Yahoo Finance API の仕様変更リスク**: 非公式v8 chart APIを使用している。現在の実装(タイムアウト・エラーハンドリング・フォールバック)は堅牢だが、公式提供ではないため将来の仕様変更リスクは残存。

詳細な所見: `.pi/review-findings.md`
