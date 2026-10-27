---

name: add-llm-tool
description: Add or change a tool the Hippo voice agent's LLM can call (e.g. a new scheduling action). Use when adding a tool, changing a tool's arguments or result, or adding an error code. Covers contracts, integrator endpoint, phoner gating, prompt, docs and tests.
---

# Add or change an LLM tool

Every tool crosses three boundaries: LLM → phoner → integrator → database. Change them in this order so types guide you.

1. **Contract** — `packages/contracts/src/tools.ts`: args schema (field `.describe()` texts are read by the LLM), result schema, entry in `toolDefinitions`. Request body for the integrator in `packages/contracts/src/api.ts` (phoner injects `patientId`; the LLM never supplies it). New error codes go in `packages/contracts/src/results.ts`.
2. **Integrator** — service in `apps/integrator/src/services/`, route in `apps/integrator/src/app.ts` wrapped in `record("<tool>")`. Map new error codes to HTTP status in `apps/integrator/src/http.ts`. Every result `message` must say what changed and what didn't ("No appointment was created."). If the tool mutates data, add it to `MUTATING` in `integration-calls.ts` and call `completeKey(tx, meta.key, result, status)` inside the same transaction as the change.
3. **phoner** — request mapping in `apps/phoner/src/tools/executor.ts`; gating in `apps/phoner/src/tools/policy.ts` (`allowedTools`, `checkTool`). Long opaque ids the LLM must echo back get short aliases like `slotId`.
4. **Prompt** — rules for when to call it in `apps/phoner/src/prompt/system-prompt.ts`.
5. **Docs** — `docs/tools.md` (tool table, gating, edge cases, error codes).
6. **Tests** — integrator integration test in `apps/integrator/test/integration/` (include a concurrency or retry case if it mutates), policy test in `apps/phoner/test/unit/tools/`, and an e2e scenario (see the `e2e-scenario` skill).

Verify: `pnpm typecheck && pnpm test && pnpm e2e`.
