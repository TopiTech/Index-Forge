# Development Command Reference

## Setup

- `npm install`
  - Install all project dependencies.

## Local development

- `npm run dev`
  - Start the Vite development server for the React frontend.

- `npm run dev:worker`
  - Run the Cloudflare Worker locally using `wrangler` with `wrangler.local.jsonc`.

## Build and preview

- `npm run build`
  - Run TypeScript checks for both the app and worker, then build the Vite production bundle.

- `npm run preview`
  - Preview the built production output locally.

## Quality checks

- `npm run lint`
  - Run ESLint over the whole project with `--max-warnings=0`, so a warning fails the run exactly like an error (CI gates on it).

- `npm test`
  - Run the Vitest suite once (CI gates deploys on lint + test).

- `npm run test:watch`
  - Run Vitest in watch mode.

## Deployment

- `npm run deploy`
  - Build the project and deploy the Worker using Wrangler.
  - **CI 専用**: `wrangler.jsonc` の `database_id` はプレースホルダ `__D1_DATABASE_ID__` のままで、GitHub Actions (`deploy.yml`) 内でのみ実値へ置換されます。ローカルからデプロイする場合は `wrangler deploy --config wrangler.local.jsonc` を使うか、事前に `wrangler.jsonc` の ID を実値へ書き換えてください。

- `npx wrangler deploy --dry-run --config wrangler.jsonc --outdir <temp dir>`
  - Validate the Wrangler configuration, bindings and the Worker bundle without uploading. `ci.yml` runs this on every pull request (build the app first: the assets directory `dist/` must exist), and the bundle is written outside the repository so the worktree stays clean.

## Database / D1

- `npm run db:migrate`
  - Apply `schema.sql` to the remote D1 database configured in `wrangler.local.jsonc`.

- `npm run db:migrate:local`
  - Apply `schema.sql` to the local D1 database using `wrangler.local.jsonc`.

- `npm run db:migrate:columns`
  - Idempotently apply column migrations (`owner_token_hash` / `created_at` / `sort_order` / `creator_id` to `indices` and `max_indices` to `access_passwords`) to the remote D1 database via `scripts/apply-migrations.mjs` (inspects existing schema so it never fails even if columns already exist).

- `npm run db:migrate:columns:local`
  - Idempotently apply column migrations to the local D1 database via `scripts/apply-migrations.mjs`.

- `npm run db:seed`
  - Seed the remote D1 database with `seed.sql`.

- `npm run db:seed:local`
  - Seed the local D1 database with `seed.sql`.

- `npm run db:reset`
  - Reset the **local** D1 database: drop every table with `schema.dev.sql`, recreate the schema with `schema.sql`, then run `npm run db:seed:local` so the result is immediately usable.
  - This is an alias of `npm run db:reset:local`. It never touches the remote database.

- `npm run db:reset:local`
  - Same as `db:reset` (`schema.dev.sql` → `schema.sql` → `seed.sql`, all with `--local`).

- `npm run db:reset:remote`
  - **DESTRUCTIVE**: drop and recreate the **remote** D1 schema (`schema.dev.sql` then `schema.sql`) and re-run `npm run db:seed` against the remote database.
  - This is the command that used to be called `db:reset`. Confirm the target database (the `database_id` in `wrangler.local.jsonc`) before running it.

## Wrangler / TypeScript helpers

- `npm run typegen`
  - Generate Wrangler TypeScript bindings.

## Notes

- `wrangler.local.jsonc` is excluded from Git and contains local Worker configuration. `dev:worker` and every `db:*` script reference it, so it must exist locally (create it with your real `database_id` after cloning).
- Use `npm run build` before deploying to ensure both the app and worker type-check cleanly.
