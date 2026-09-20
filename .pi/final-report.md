# IndexForge コードレビュー最終報告(2026-09-20・goal mu8gslck-b7vqlq)

## 1. 調査範囲

- **バックエンド**: `worker/index.ts`(全API経路: `/api/health`, `/api/auth/verify`, `/api/admin/passwords`(GET/POST/PUT/DELETE), `/api/admin/admin-password`, `/api/indices`(GET/POST/DELETE), `/api/indices/stock`(POST/DELETE), `/api/snapshot`, `/api/ticker-prices`, `/api/sync-prices`, `/api/calculate`、静的配信+CSP/HSTS/X-Frame-Options 等セキュリティヘッダー)
- **計算ロジック**: `src/lib/indexEngine.ts`(ウェイト正規化・指数計算・欠落データ補完)、`src/lib/analytics.ts`(リスク指標・SMA・銘柄詳細)、`src/lib/marketCache.ts`(東証開場時間ベースのキャッシュ)、`src/lib/yahooSymbol.ts`、`src/lib/auth.ts`、`src/lib/ownership.ts`、`src/lib/navigation.ts`、`src/lib/timeframe.ts`、`src/lib/csv.ts`、`src/lib/downloadFileName.ts`
- **フロントエンド**: `src/App.tsx`(ルーティング・遅延読込)、全hooks(`useAuth`/`useIndices`/`useCalculation`/`useSimulation`/`useBenchmark`)、主要コンポーネント(Header/AdminDashboard/ConstituentsTable/IndexBuilderContent・Modal・Page/PerformanceChart/TradingViewChartModal・TickerTape/SimulationPreview/ThemeHeatmap/モーダル群/IndexSelector/Portfolio/Disclaimer/Footer/ui/Tutorial)
- **DB/設定**: `schema.sql`/`schema.migration.sql`/`schema.dev.sql`/`seed.sql`、`wrangler.jsonc`/`wrangler.local.jsonc`、`vite.config.ts`、`tsconfig.app.json`/`tsconfig.worker.json`、`index.html`、`public/asset-error-recovery.js`、CI(`.github/workflows`)
- **検証手段**: 手動精読 + `npm run build`(tsc app + tsc worker + vite)・`npm run lint`・`npm test`(vitest)の全実行。Workerのクォータガード付き書き込みSQLはコード精読で確認(前回goalで node:sqlite 実SQLプローブ済みのため本roundは再掲のみ)。

## 2. 発見した問題と重要度

| ID | 重要度 | 問題 | 対応 |
|----|--------|------|------|
| R1 | P1 High | `useIndices.saveCustomIndex` がサーバ未確認のcaller-token(`ownerToken ? token : null`)を保存し、管理者が他者指数を編集すると当該ブラウザが「自分の指数」と誤表示する | **修正済み** |
| R2 | P2 Med | `deleteCustomIndex`/`removeStockFromIndex` が ownerToken をURLクエリ(`ownerToken=`)に重複送信し、サーバログ・ブラウザ履歴・分析基盤へ秘密漏洩する | **修正済み**(ヘッダーのみ) |
| R3 | P2 Med | `SYSTEM_INDICES` が `worker/index.ts` と `src/data/indices.ts` で二重定義され、将来の乖離リスクがある | **修正済み**(一元化) |
| R4 | P2 Med | `three.js`(約563KB)・`recharts`・管理画面等を初回バンドルで全量読込し、初回表示が重い | **修正済み**(ルート遅延読込) |
| R5 | P3 Low | `TradingViewChartModal` がウィジェット設定JSONを `script.innerHTML` に代入(可読性・一貫性の問題; 同一ファイル内のコンテナクリア `container.innerHTML=""` は空文字のみで実害なし) | **修正済み**(`textContent` 化) |

重大(クリティカル)の認証突破・計算破綻・CSP破綻は発見されませんでした(PBKDF2+timingSafeEqual、CSP/HSTS/X-Frame-Options は実在確認済み)。

## 3. 変更内容と判断理由

- `src/hooks/useIndices.ts`: 純粋ヘルパー `withOwnerTokenHeader` / `buildDeleteIndexRequest` / `buildDeleteStockRequest` / `buildSaveIndexRequest` / `resolvePersistedOwnerToken` を新設し、save/delete 全経路を配線。`resolvePersistedOwnerToken` は引数にcaller-tokenを持たず、サーバエコー(`data.ownerToken`)または既存保存値のみ返す構造とし、未確認トークンの保存を型レベルで不可能にした。DELETE系のURLから `ownerToken` を除去し `x-owner-token` ヘッダーのみに統一。判断理由: 秘密のURL漏洩排除と所有権誤表示の根本解消。リファクタは問題の解決に必要な最小範囲。
- `worker/index.ts`: `SYSTEM_INDICES` のリテラル定義を削除し `src/data/indices` の共有定義を `SHARED_SYSTEM_INDICES` として再エクスポート。判断理由: 二重定義の乖離防止。公開API・挙動不変。
- `src/components/TradingViewChartModal.tsx`: `script.innerHTML = JSON.stringify(...)` → `script.textContent = ...`。判断理由: スクリプト要素へのテキスト注入の正規形に統一。
- `src/App.tsx`: `TutorialPage`/`AdminDashboard`/`IndexBuilderPage`/`PortfolioPage`/`DisclaimerPage` を `React.lazy` + `Suspense(<LoadingScreen/>)` 化。判断理由: R4の対応。build出力で `three-*.js` が初回チャンクから分離されることを確認(`TutorialPage-*.js` 等の別チャンク化)。
- テスト: `codeReviewGoalResolution.test.ts` の旧「URLにownerTokenを含める」肯定テストを、実ビルダー関数を行使するヘッダー限定テストに書換え(矛盾の解消)。`reviewRegression.test.ts` の旧文字列assertion(`const responseToken =`)を `resolvePersistedOwnerToken(data, storedToken)` 配線の検証に更新。新規 `comprehensiveReviewCurrentRound.test.ts`(8件)はビルダー関数の実行時振る舞い(URLにトークンが含まれないこと・ヘッダー送信・保存解決・SYSTEM_INDICES一致・textContent)を直接検証。

## 4. 互換性への影響

- 公開API・データ形式・DBスキーマの変更は **なし**。
- Workerは旧来のクエリ(`?ownerToken=`)・ボディ(`ownerToken`)受付を維持しているため、旧クライアント・外部スクリプトは引き続き動作する(サーバ側の互換維持。クライアントは今後ヘッダーのみを送信)。
- `SYSTEM_INDICES` の再エクスポートにより `worker/index` からの既存importは不変。
- 遅延読込は内部分割のみでルーティング・UI文言・操作フロー不変。`Suspense` フォールバックは既存 `LoadingScreen` を再利用。
- 保存済み指数・所有トークン・認証フロー・D1データへの影響なし。移行措置は不要。

## 5. テスト結果

| 検証 | 結果 |
|------|------|
| `npm run build`(tsc app + tsc worker --noEmit + vite build) | ✅ 成功・警告0(別チャンク `TutorialPage`/`AdminDashboard`/`IndexBuilderPage`/`PortfolioPage`/`DisclaimerPage` を確認) |
| `npm run lint`(eslint .) | ✅ 違反0 |
| `npm test`(vitest run) | ✅ 66ファイル / 617テスト全成功 |

再発防止テスト: `comprehensiveReviewCurrentRound.test.ts`(8件・行動検証)、`codeReviewGoalResolution.test.ts`(ヘッダー限定・実ビルダー行使)、`reviewRegression.test.ts`(配線回帰)。変更起因の警告・エラーなし。

## 6. 未解決・未検証事項

1. **実ブラウザでの視覚確認未実施**: レスポンシブ・フォーカストラップ・遅延ページのフォールバック表示はコード精読で確認したが、実デバイスのスクリーンショット検証は行っていない。
2. **実機D1/本番デプロイ未実施**: `wrangler dev`/本番デプロイ・本番DB操作は行っていない(Cloudflare認証情報が必要なため)。本goalの変更はスキーマ・API不変であり、本番DB/デプロイは不要と判断。フル対応方針のもとでも実施すべき本番操作は発生しなかった。
3. **Yahoo Finance APIの仕様変更リスク**: 非公式v8 chart APIを使用。タイムアウト・異常系・フォールバックは実装済みだが、将来の仕様変更リスクは残存。
4. **依存ライブラリの脆弱性通知**: `npm audit` で dev経由(sharp ← miniflare ← wrangler)の moderate/high 5件を観測。本番バンドルに同梱されない開発専用経路であり、今回の監査では対応不要と判断(記録のみ)。

## 7. 前回監査却下(4点)への対応

1. **最終報告の不備** → 本ファイル(現goal専用)を `.pi/final-report.md` として更新し、詳細所見を `.pi/review-findings.md` に更新。ledger要約のみに依存しない検査可能な報告とした。
2. **矛盾の残置** → `codeReviewGoalResolution.test.ts` の旧URL肯定テストを実ビルダー行使のヘッダー限定テストに書換え。`reviewRegression.test.ts` も新配線のassertionに更新。
3. **弱い検証** → 新規8件を行動検証化(`resolvePersistedOwnerToken` の保存解決、`buildDeleteIndexRequest` 等のURL/ヘッダー実実行、`SYSTEM_INDICES` の実値一致)。文字列検索は配線センチネルのみに限定。
4. **範囲の不可視性** → R4に `React.lazy` 対応を実施しbuildチャンクで実証。依存(`npm audit`結果)・仕様整合(Worker互換維持)・UI/アクセシビリティ(既存のフォーカストラップ/inert/aria維持、視覚未検証を明示)・本番DB/デプロイ判断根拠(スキーマ/API不変のため不要)を本報告に記録。
