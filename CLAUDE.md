# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. Read this first, then the doc linked for the area you're changing.

## What this project is

Hippo is a voice AI agent that schedules 30-minute doctor appointments at a single multi-specialty medical center. A caller speaks; the agent verifies their identity (name + date of birth), routes them to a doctor or specialty, checks availability and books, cancels, reschedules or lists appointments. Patient safety and booking correctness matter more than cleverness: when a change trades one for the other, choose correctness and say so.

Design docs live in [`docs/`](docs/README.md). The most important ones before touching code:

- [`docs/architecture.md`](docs/architecture.md) — services and the realtime pipeline
- [`docs/tools.md`](docs/tools.md) — LLM tool contracts, gating, error codes
- [`docs/concurrency.md`](docs/concurrency.md) — how booking races are resolved

## Repository layout

```
apps/web          Next.js call console (Vercel). No auth.
apps/phoner    Realtime voice service: STT → LLM → guardrail → TTS, turn-taking, tool gating
apps/integrator   Tool-execution HTTP API (Hono): scheduling rules + database
apps/e2e          Playwright end-to-end tests
packages/contracts  zod schemas shared by all apps: tool I/O, error codes, WebSocket messages
packages/db         Drizzle schema, migrations, seed, client
packages/ui         shadcn/ui components and styles
packages/tsconfig   Shared TypeScript configs
```

Dependency direction: apps → packages; `contracts` depends on nothing internal; `phoner` never imports `db` (it reaches data only through the integrator).

## Commands

```bash
pnpm install
docker compose up -d db && pnpm db:migrate && pnpm db:seed   # local Postgres
pnpm dev                                            # web :3000, phoner :4000, integrator :4001
pnpm lint          # Biome: lint, import order, formatting
pnpm format        # Biome format (write); format:check in CI
pnpm typecheck
pnpm test          # Vitest unit + integration (needs local DB)
pnpm test:unit     # unit only, no DB
pnpm e2e           # Playwright with scripted providers
pnpm --filter @hippo/<name> <script>   # one package
```

Before saying a change is done, run `pnpm lint && pnpm typecheck && pnpm test` and report the result. If you changed the call flow or console, also run `pnpm e2e`.

## Conventions

### Contracts first

Any data crossing a process boundary (browser ⇄ phoner, phoner ⇄ integrator, LLM tool args) is defined once as a zod schema in `packages/contracts` and parsed at the boundary. Change the contract first, then the producer and consumer in the same commit. Types are inferred from schemas (`z.infer`), not written twice.

### Providers via Factory Method

LLM, STT, TTS, guardrail and transport implementations sit behind interfaces in `apps/phoner/src/providers/<kind>/` and are created by `create<Kind>Provider(config)`. Pipeline code depends on the interface only. To add a provider: one new class, one enum value, one factory case, a contract test. See [`docs/providers.md`](docs/providers.md). Don't import a vendor SDK outside its provider file.

### Scheduling rules live in the integrator

The LLM proposes; the integrator decides. Rules such as "availability before booking", ownership checks and double-booking prevention are enforced in integrator code and the database, never only in the prompt. phoner additionally gates which tools the LLM can see (`ToolPolicy`), and injects the verified `patientId` — the LLM never supplies it.

### Database

- Schema changes: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, commit schema and migration together. Never edit an applied migration.
- Booking races are resolved by the partial unique index and `INSERT … ON CONFLICT DO NOTHING`; don't add application-level locks or check-then-insert logic.
- Migrations must be backward compatible with the currently deployed code (expand, then contract).

### TypeScript

- Strict mode; no `any` (use `unknown` and parse). No non-null assertions without a comment explaining why it's safe.
- ES modules, named exports. File names in kebab-case.
- Validate env with zod at startup; read config through the validated object, not `process.env`.
- Prefer small pure functions for logic (slot math, chunking, policy) so they are unit-testable without I/O.

### Comments

Default to no comments. Names, small functions and zod schemas should explain the code; design rationale belongs in `docs/`, not in source.

- No file-header, section or "this module does X" comments, and no TSDoc that restates a name or signature.
- When something is genuinely non-obvious (a race, a provider quirk, a workaround), write one short line saying why. Link the issue or vendor doc if there is one.
- TSDoc only on a shared-package export whose behavior can't be read from its signature; one sentence, no type info in tags.
- LLM tool and field `description`s are prompts, not comments; keep them short and literal.
- No commented-out code, no author/changelog notes. TODOs reference an issue: `// TODO(#12): …`.

### Naming

Short, plain file and symbol names: `api.ts`, not `integrator-api.ts`; the package or folder already gives the context.

### Formatting and lint

Biome lints and formats; there is no Prettier. The pre-commit hook runs `biome check --write` on staged files. Don't disable a lint rule inline without a short reason in the same comment.

## Testing expectations

- Tests live only in `test/unit/` (no I/O) or `test/integration/`, never in `src/`. See [`docs/testing.md`](docs/testing.md).
- New logic gets unit tests in `test/unit/`, at the same path as the code.
- Integrator endpoints get integration tests against a real Postgres (`apps/integrator/test/integration/`); anything touching booking includes a concurrency case.
- Call-flow changes get or update a Playwright scenario in `apps/e2e/scenarios/`. Scripted providers (`LLM_PROVIDER=scripted`, `STT_PROVIDER=none`, `TTS_PROVIDER=silent`) make e2e deterministic; never assert exact wording from a real LLM.
- Don't weaken or delete a failing test to make it pass; fix the cause or explain why the test is wrong.

## Patient data and safety

This handles personal health information, even if only demo data today.

- Log IDs and event types, not names, DOBs or transcripts. Transcripts belong in `call_events`, not stdout.
- Tools return data only for the verified patient of the current call.
- The agent never diagnoses or gives medical advice. Prompt changes that touch triage, emergencies or identity verification need a matching update in [`docs/conversation-design.md`](docs/conversation-design.md) and an e2e scenario.
- Never put real patient data in fixtures, seeds or tests.
- `.env` is never committed. Keep the production database URL in `PROD_DATABASE_URL`, never `DATABASE_URL`, so local scripts can't reach production.

## Working style

- Read the relevant files and docs before editing; match the surrounding code.
- Keep changes scoped to the task. Don't add features, abstractions or config that weren't asked for; propose them instead.
- When a design decision changes, update the doc or add an ADR in `docs/adr/` in the same change.
- Ask before destructive or outward-facing actions: dropping data, running `db:migrate:prod`, force-pushing, changing CI secrets or Vercel settings.

## Skills

Project skills live in `.claude/skills/` (Agent Skills format, versioned with the repo). Use them for these workflows:

| Skill                          | When                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `add-llm-tool`                 | adding or changing an LLM tool, its args, results or error codes |
| `add-provider`                 | adding or swapping an LLM, STT, TTS or guardrail provider        |
| `db-schema-change`             | any change to `packages/db/src/schema.ts`                        |
| `e2e-scenario`                 | a call-flow change that needs a Playwright test                  |
| `prompt-change`                | changing the system prompt, triage or confirmation behavior      |
| `adr-skill` (from `vercel/ai`) | recording or consulting a design decision in `docs/adr/`         |

Third-party skills are pinned in `skills-lock.json`; restore them with `npx skills experimental_install`.
