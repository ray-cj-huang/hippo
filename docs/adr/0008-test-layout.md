# 0008 — Tests in `test/unit` and `test/integration`

- Status: accepted
- Date: 2026-10-27

## Context

Unit tests sat next to the code in `src/`, integration tests in `apps/integrator/test/`. pnpm, Turborepo and Vitest don't prescribe either layout; both are common. Mixing tests into `src/` made it easy for test helpers to end up importable from production code, and the integrator's unit tests were picked up by the database setup.

## Decision

`src/` holds source only. Each package keeps tests in `test/unit/` (no I/O, same path as the code they cover) and `test/integration/` (real services, with their setup and helpers). Shared fixtures sit at the top of `test/`. Every package has a `test:unit` script, plus `test:integration` when it has integration tests, so Turborepo runs them consistently.

## Consequences

- Production code can't import test helpers, and builds never see tests.
- Unit tests run without a database (`pnpm test:unit`, pre-push); integration tests run in CI and on demand.
- Test imports are longer (`../../src/...`), and moving a source file means moving its test.
