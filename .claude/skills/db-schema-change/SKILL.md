---

name: db-schema-change
description: Change the Hippo Postgres schema (tables, columns, indexes, enums) with Drizzle and ship the migration safely. Use for any edit to packages/db/src/schema.ts or when a feature needs new data.
---

# Change the database schema

1. Before running any DB command, check which host `DATABASE_URL` points to (`sed 's/=.*//' .env` for names; never print values). Local is `127.0.0.1:54322` (`docker compose up -d db`). Production lives only in `PROD_DATABASE_URL`.
2. Edit `packages/db/src/schema.ts`. Every table gets `.enableRLS()` (Supabase exposes the public schema over REST otherwise).
3. `pnpm db:generate` (drizzle-kit may prompt about renames; it needs a TTY). Review the SQL in `packages/db/drizzle/`. Never edit a migration that has been applied anywhere.
4. Keep migrations backward compatible with the running code: add nullable columns or defaults first, backfill, then tighten in a later migration.
5. `pnpm db:migrate && pnpm db:seed` locally. Integration tests use the `hippo_test` database and e2e uses `hippo_e2e`; both migrate themselves.
6. Booking correctness relies on the partial unique indexes on `appointments` and on single-statement inserts; don't replace them with application locks.
7. Update `docs/data-model.md`. Add an ADR in `docs/adr/` if the change is a design decision.
8. Production migrations run in CI on merge to `main` (`release.yml`). Only run `pnpm db:migrate:prod` by hand when the user asks.

Verify: `pnpm --filter @hippo/db typecheck && pnpm test`.
