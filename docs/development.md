# Development

## Prerequisites

| Tool           | Version                                     | Install                               |
| -------------- | ------------------------------------------- | ------------------------------------- |
| Node.js        | 24 LTS (see `.nvmrc`)                       | `nvm install`                         |
| pnpm           | 12, pinned in `package.json#packageManager` | `npm i -g pnpm@12`                    |
| Docker Desktop | running                                     | local Postgres (`docker-compose.yml`) |

Keep the production database URL in `.env` as `PROD_DATABASE_URL`, never `DATABASE_URL`; `pnpm db:migrate` and `pnpm db:seed` refuse non-local hosts.

API keys in `.env` (copy `.env.example`): `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`.

## First run

```bash
pnpm install
docker compose up -d db        # Postgres 17 on 127.0.0.1:54322
pnpm db:migrate
pnpm db:seed
pnpm dev                       # web :3000, phoner :4000, integrator :4001
```

Open http://localhost:3000 and press **Start call**.

## Commands

| Command                             | What                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                          | All apps in watch mode (Turborepo)                                |
| `pnpm kill`                         | Kill stray node listeners on :3000, :4000, :4001                  |
| `pnpm build`                        | Build everything                                                  |
| `pnpm lint` / `pnpm lint:fix`       | Biome check: lint, import order, formatting                       |
| `pnpm format` / `pnpm format:check` | Biome format                                                      |
| `pnpm typecheck`                    | `tsc --noEmit` in every package                                   |
| `pnpm test`                         | Vitest unit + integration                                         |
| `pnpm test:unit`                    | Vitest unit only (no database)                                    |
| `pnpm e2e`                          | Playwright `dev` project (scripted providers)                     |
| `pnpm e2e:live`                     | Playwright with real providers (needs keys)                       |
| `pnpm db:generate`                  | Generate a migration from schema changes                          |
| `pnpm db:migrate`                   | Apply migrations to `DATABASE_URL`                                |
| `pnpm db:migrate:prod`              | Apply migrations to `PROD_DATABASE_URL` (explicit, never default) |
| `pnpm db:seed`                      | Reset and seed the local DB                                       |
| `pnpm db:studio`                    | Drizzle Studio                                                    |

Run a single app: `pnpm --filter @hippo/phoner dev`.

## Git hooks (Husky)

- **pre-commit**: lint-staged → `biome check --write` on staged files.
- **pre-push**: `pnpm typecheck && pnpm test:unit` (integration tests need the local database, so they run in CI and on demand).

## Working without API keys

```bash
LLM_PROVIDER=scripted STT_PROVIDER=none TTS_PROVIDER=silent pnpm dev
```

The console then plays a scripted scenario; useful for UI work.

## Local database

`docker-compose.yml` runs plain Postgres 17 (the major version Supabase hosts) on port 54322. Production uses Supabase's hosted Postgres; nothing Supabase-specific runs locally. Reset everything with `docker compose down -v && docker compose up -d db && pnpm db:migrate && pnpm db:seed`.

## Changing the database

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate` → review the SQL in `packages/db/drizzle/`.
3. `pnpm db:migrate`.
4. Commit schema + migration together. CI applies it to prod on merge.

Never edit an applied migration; add a new one.
