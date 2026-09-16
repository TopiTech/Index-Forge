# IndexForge (Cloudflare Workers Edition)

Cloudflare D1 データベースと連携し、独自のカスタム株価指数を日足終値ベースで追跡・分析するためのプラットフォームです。

## 特徴

- **ダイナミック計算**: 構成銘柄と比率を自在に設定し、独自指数を生成。
- **データ永続化**: Cloudflare D1 による安定したインデックス定義の管理。
- **モダンデザイン**: Outfit フォントを採用した、レスポンシブで洗練された UI/UX。
- **高パフォーマンス**: Cloudflare Workers + Vite による高速な配信と実行。

## システム構成

- **フロントエンド**: React + Vite (Vanilla CSS)
- **バックエンド**: Cloudflare Workers (TypeScript)
- **データベース**: Cloudflare D1
- **ホスティング**: Cloudflare Workers Static Assets

## ローカル開発

### 1. フロントだけ確認

```bash
npm install
npm run dev
```

### 2. build を作って Worker で確認

```bash
npm install
npm run build
npm run dev:worker
```

## 本番デプロイ

### 1. Cloudflare での準備
1.  Cloudflare Dashboard で D1 データベースを作成します。
2.  `schema.sql` を実行してテーブルを作成します（冪等・非破壊）。
    ```bash
    npx wrangler d1 execute original-stock-index-db --remote --file=schema.sql
    ```
    開発環境でクリーンスレートが必要な場合は `schema.dev.sql` で DROP してから `schema.sql` を実行してください（本番では `schema.dev.sql` を実行しないでください）。

### 2. GitHub Secrets の設定
GitHub Actions でCloudflare Workersに自動デプロイを行うため、以下の Secret を設定してください。

- `CLOUDFLARE_API_TOKEN`: Cloudflare の API トークン（Cloudflare Workers 編集権限）
- `D1_DATABASE_ID`: 作成した D1 データベースの ID (UUID)

### 3. 管理者パスワードの設定
管理者パスワードに組み込みの初期値はありません。初回デプロイ前に Worker Secret を設定してください。

```bash
npx wrangler secret put ADMIN_PASSWORD
```

初回ログイン後に管理画面からマスター管理者パスワードを変更すると、以後は D1 に保存された PBKDF2 ハッシュだけが有効になります。旧バージョンで `plain_password` 列を持つ D1 を利用している場合は、バックアップを取得したうえで `schema.migration.sql` を一度だけ実行し、既存の平文値を消去してください。

## 主要ファイル

- `wrangler.jsonc`: Workers 設定（データベース ID は CI/CD で自動注入されます）
- `worker/index.ts`: API および静的配信のエントリポイント
- `src/lib/indexEngine.ts`: 指数計算ロジック（欠落データ対応済み）

## 開発上の注意

- **データ同期**: Yahoo Finance からの取得は市場時間帯に応じたキャッシュが効くように実装されています。取引時間中に同期したデータは当日15:30の30分後まで、取引時間外に同期したデータは次の平日09:00まで再利用されます。強制更新する場合は、パスワード認証付きで `/api/sync-prices` に `{ "force": true }` を送ってください。
- **セキュリティ**: ローカル環境でのDB更新を楽にするため、実際のデータベース IDを記述した`wrangler.local.jsonc` を任意で作成してください。これは git 管理外（`.gitignore`）に設定されています。管理画面で発行したユーザーパスワードは作成直後のレスポンスでのみ表示され、一覧や D1 には平文で保存されません。

## ライセンス

MIT License
