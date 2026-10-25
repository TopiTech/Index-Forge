# IndexForge (Cloudflare Workers Edition)

マーケット観測・カスタム指数の作成・銘柄スクリーナー・決算/マクロ経済カレンダー・ポートフォリオ管理をひとつにまとめた統合投資情報プラットフォームです。

## 特徴

- **統合ナビゲーション**: グループ化された左サイドバーで、マーケット観測/指数開発/リサーチ/資産管理を一気通貫で操作。
- **ダイナミック計算**: 構成銘柄と比率を自在に設定し、独自指数を生成。
- **データ永続化**: Cloudflare D1 による安定したインデックス定義の管理。
- **モダンデザイン**: Outfit / Inter / JetBrains Mono を軸にした、レスポンシブで洗練された UI/UX。
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

`npm run dev:worker` と `db:*` スクリプトは `wrangler.local.jsonc` を参照します。このファイルは git 管理外のため、あらかじめ作成しておいてください（下記「開発上の注意」参照）。

```bash
npm install
npm run build
npm run dev:worker
```

## 本番デプロイ

### 1. Cloudflare での準備
1.  Cloudflare Dashboard で D1 データベースを作成し、その ID を `wrangler.local.jsonc`（git 管理外）の `database_id` に記入しておきます。
2.  `schema.sql` を実行してテーブルを作成します（冪等・非破壊）。

    > **注意（手元で Wrangler を実行する場合）**: リポジトリ同梱の `wrangler.jsonc` の `database_id` はプレースホルダ `__D1_DATABASE_ID__` で、GitHub Actions のデプロイ時にのみ実値へ置換されます。したがって、以下のように手元で `npx wrangler ...` を直接実行するときは **必ず `--config wrangler.local.jsonc` を付けてください**。付け忘れるとプレースホルダの ID を参照して失敗します。

    ```bash
    npx wrangler d1 execute original-stock-index-db --remote --config wrangler.local.jsonc --file=schema.sql
    ```
    同じ操作は `npm run db:migrate`（リモート）/ `npm run db:migrate:local`（ローカル）でも実行できます。開発環境でクリーンスレートが必要な場合は `schema.dev.sql` で DROP してから `schema.sql` を実行してください（本番では `schema.dev.sql` を実行しないでください）。ローカル DB の初期化は `npm run db:reset`（= ローカルのみ + seed 投入）を使ってください。

### 2. GitHub Secrets の設定
GitHub Actions でCloudflare Workersに自動デプロイを行うため、以下の Secret を設定してください。

- `CLOUDFLARE_API_TOKEN`: Cloudflare の API トークン（Cloudflare Workers 編集権限）
- `D1_DATABASE_ID`: 作成した D1 データベースの ID (UUID)

### 3. 管理者パスワードの設定
管理者パスワードに組み込みの初期値はありません。初回デプロイ前に Worker Secret を設定してください。

```bash
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
```

`--config wrangler.local.jsonc` は必須です（`wrangler.jsonc` は `database_id` がプレースホルダのため、手元からの Wrangler 実行では使いません。詳細は「1. Cloudflare での準備」の注意書きを参照）。

初回ログイン後に管理画面からマスター管理者パスワードを変更すると、以後は D1 に保存された PBKDF2 ハッシュだけが有効になります。旧バージョンで `plain_password` 列を持つ D1 を利用している場合は、バックアップを取得したうえで `schema.migration.sql` を一度だけ実行してください。同ファイルは `schema.sql` から生成されるため手編集せず、平文値の消去が必要な場合はファイル冒頭に記載された `UPDATE access_passwords SET plain_password = NULL ...` を手動で実行してください。

### 4. 管理者ログインの2要素認証(秘密の暗号 + Turnstile)の設定

管理者ログイン (`/api/auth/admin-login`) はパスワードに加えて「秘密の暗号」と Cloudflare Turnstile(ロボット確認)の両方を要求します。リポジトリに同梱された開発用の既定値は **localhost などローカル開発環境とテスト時のみ** 使用でき、その他のホストでは本番用の設定が必須です(公開リポジトリに置かれた既定値を本番の第二要素にすると、2要素目が誰でも知り得る定数になってしまうため)。

```bash
npx wrangler secret put ADMIN_SECRET_CODE --config wrangler.local.jsonc     # 秘密の暗号(未設定なら管理画面で変更する前に必須)
npx wrangler secret put TURNSTILE_SITE_KEY --config wrangler.local.jsonc    # Turnstile のサイトキー(公開鍵)
npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.local.jsonc  # Turnstile のシークレットキー
```

Secret を設定するときも `--config wrangler.local.jsonc` を付けてください（`wrangler.jsonc` の `database_id` はプレースホルダのため）。

- Turnstile のキーは Cloudflare ダッシュボードで発行します。テスト用キーの挙動は[公式ドキュメント](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)を参照してください。
- 管理画面で秘密の暗号を変更済みの環境では D1 のハッシュが優先されるため、`ADMIN_SECRET_CODE` は不要です。
- **移行(既存の本番環境)**: 上記を設定しないと次回以降の管理者ログインが失敗します(エラーメッセージに設定すべき Secret 名が表示されます)。一般ユーザーログイン、公開 API、サイト表示には影響しません。

## 主要ファイル

- `wrangler.jsonc`: Workers 設定（データベース ID は CI/CD で自動注入されます）
- `worker/index.ts`: API および静的配信のエントリポイント
- `src/lib/indexEngine.ts`: 指数計算ロジック（欠落データ対応済み）

## 開発上の注意

- **データ同期**: Yahoo Finance からの取得は市場時間帯に応じたキャッシュが効くように実装されています。取引時間中に同期したデータは当日15:30の30分後まで、取引時間外に同期したデータは次の平日09:00まで再利用されます。強制更新する場合は、パスワード認証付きで `/api/sync-prices` に `{ "force": true }` を送ってください。
- **セキュリティ**: `npm run dev:worker` および `db:*` スクリプトは `--config wrangler.local.jsonc` を参照します。このファイルは git 管理外（`.gitignore`）のため、クローン直後は実際のデータベース ID を記述した `wrangler.local.jsonc` を**作成する必要があります**（作成しない場合、これらのコマンドは設定ファイル不足でエラーになります）。管理画面で発行したユーザーパスワードは作成直後のレスポンスでのみ表示され、一覧や D1 には平文で保存されません。
- **DB リセットの安全性**: `npm run db:reset` は**ローカル** D1 を初期化し、最後に `seed.sql` を投入します（`npm run db:reset:local` と同義）。リモート D1 を初期化する破壊的コマンドは `npm run db:reset:remote` に分離しました（`schema.dev.sql` で全テーブルを DROP → `schema.sql` → `seed.sql`）。リモートに対して実行するときは対象 DB を必ず確認してください。
- **CI の検証**: `.github/workflows/ci.yml` は lint / test / build に加えて `npx wrangler deploy --dry-run --config wrangler.jsonc` を実行し、`wrangler.jsonc` の解析・バインディング解決・Worker バンドルをマージ前に検証します（バンドルはリポジトリ外の一時ディレクトリへ出力）。

## ライセンス

MIT License
