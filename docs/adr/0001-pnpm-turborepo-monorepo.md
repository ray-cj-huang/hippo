# 0001 — pnpm + Turborepo monorepo

- Status: accepted
- Date: 2026-10-27

## Context

Three apps (web, phoner, integrator) share schemas, DB code and config. Changes often touch several of them at once (a new tool changes contracts, integrator, phoner and the console).

## Decision

One repo, pnpm workspaces, Turborepo for task orchestration and caching. Layout follows create-t3-turbo: `apps/*` deployables, `packages/*` shared libraries (`contracts`, `db`, `ui`, `tsconfig`). Internal packages are consumed as TypeScript source (`"exports"` → `src/*.ts`) so there is no build step between them.

## Consequences

- Atomic changes across services, one CI pipeline, shared lint/format config.
- Vercel builds only `apps/web` and uses `turbo-ignore` to skip unrelated commits.
- Docker images must copy the workspace subset they need (`turbo prune`).
