# Testing

`src/` holds source only. Every test lives in the package's `test/` folder ([ADR 0008](adr/0008-test-layout.md)):

- `test/unit/` — unit tests, at the same path as the code they cover (`src/pipeline/call-session.ts` → `test/unit/pipeline/call-session.test.ts`). No database, network or env; they run with `pnpm test:unit`.
- `test/integration/` — tests against real services, plus their setup and helpers.
- Fixtures shared by both, such as scripted scenarios, sit at the top of `test/` (e.g. `apps/phoner/test/scenarios/`).

`apps/e2e` is a test-only app and keeps Playwright specs and scenarios in its own folders.

| Layer            | Tool                   | Where                               | Command                                            | Runs in                                                               |
| ---------------- | ---------------------- | ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| Unit             | Vitest                 | `{apps,packages}/*/test/unit/`      | `pnpm test:unit`                                   | pre-push, CI                                                          |
| Integration (DB) | Vitest + real Postgres | `apps/integrator/test/integration/` | `pnpm --filter @hippo/integrator test:integration` | CI (Postgres service), locally against `docker compose up -d db`      |
| End-to-end       | Playwright             | `apps/e2e`                          | `pnpm e2e`                                         | CI (`dev` project), post-deploy (`deployed`), manual/nightly (`live`) |

`pnpm test` runs unit and integration together. In the integrator they are separate Vitest projects (`unit`, `integration`), and only `integration` runs the database setup.

## Unit

- `SentenceChunker` — boundaries, abbreviations ("Dr.", "a.m."), numbers ("9.30"), max-length flush.
- `ToolPolicy` — which tools are offered/blocked per state.
- Factories — each config value returns the right class; invalid config fails.
- `CallSession` tool loop with `ScriptedLlmProvider` — tool result fed back, errors surfaced, barge-in aborts.
- Integrator pure logic — `ClinicTime` across DST changes and independent of the host's `TZ`, `slotToken` sign/verify/expiry, request hashing for idempotency.
- `normalizeName` (`packages/db`) — accents, case, punctuation, non-Latin letters.
- Console Database panel (`apps/web/lib/database.ts`) — reschedule vs. cancellation status, search matching, a patient's or doctor's appointments.

## Integration (integrator + Postgres)

Tests run against a separate `hippo_test` database on the local Postgres container (created and migrated by `test/integration/global-setup.ts`), with a fixed clock (Monday 2026-11-02 08:00 Pacific). Each test truncates and reseeds, so dev data is never touched.

- 20 concurrent `POST /appointments` with the same token → exactly 1 `201`, 19 `SLOT_TAKEN` with alternatives.
- Missing, tampered or expired token → `AVAILABILITY_REQUIRED`.
- Reschedule into a taken slot → original appointment untouched.
- Cancel frees the slot (availability shows it again).
- Verify: same name, different DOB → different patients; `newPatient: true` with an existing match returns that patient.
- Idempotency: same key and call → one appointment, `replayed: true`, two `integration_calls` rows; same tool-call id in another call → independent; same key with a different request → 422; fresh lease → 409; expired lease → taken over; key completed in the booking's transaction.
- History: book / cancel / reschedule write the matching `appointment_events`, linked to their `integration_calls` row.

## End-to-end (Playwright, `apps/e2e`)

### Scripted providers

E2E runs the real web, phoner and integrator on their own ports (3100 / 4100 / 4101) against a dedicated `hippo_e2e` database, with phoner started as:

```
LLM_PROVIDER=scripted STT_PROVIDER=none TTS_PROVIDER=silent
```

These are normal providers behind the same factories (no test-only branches in pipeline code). The test types caller turns into the console (`user.text`), and a scenario file scripts the agent, one list of steps per caller turn:

```yaml
# apps/e2e/scenarios/race-john.yaml
turns:
  - - tool: verify_patient
      args: { firstName: John, lastName: Smith, dob: "1980-05-12", callerConfirmed: true }
    - tool: get_availability
      args: { specialty: dermatology, date: "$date.nextTuesday" }
    - say: Dr. Hannah Lee has an opening. Shall I book it?
  - - tool: book_appointment
      args: { slotId: "$get_availability.slots.0.slotId", reason: rash }
```

`$<tool>.<path>` reads the latest result of that tool and `$date.next<Weekday>` is the next such day in clinic time. The page passes `?scenario=<name>` to phoner in `session.start`. Tool calls hit the real integrator and database, so races and errors are real.

### Projects

| Project    | Target                                    | What                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`      | local stack via Playwright `webServer`    | Scenarios: new patient → register → availability → book → row in DB panel; returning patient list / cancel / reschedule; **race** (two browser contexts, same slot → one success, one `SLOT_TAKEN` with alternatives in the tool panel); booking before availability blocked; emergency phrase → no tool calls; barge-in → `audio.clear` received, agent text truncated |
| `live`     | local stack with real Gemini + Cartesia   | Typed caller turns through a returning-patient booking with the real model. Asserts tool outcomes (`verify_patient` ok, `book_appointment` ok), never exact wording. Needs API keys; run on demand (`e2e-live.yml`). Microphone-audio tests with `--use-file-for-fake-audio-capture` are a later addition.                                                              |
| `deployed` | `BASE_URL` (Vercel preview or production) | Smoke: page loads, panels render, "Phoner offline" state shown when no backend is reachable. Uses `VERCEL_AUTOMATION_BYPASS_SECRET` for protected previews. Becomes full-call once phoner is hosted.                                                                                                                                                                    |

Commands: `pnpm e2e`, `pnpm e2e:live`, `pnpm e2e:deployed`. Traces and videos are kept on failure and uploaded as CI artifacts.

## What CI runs

- Every PR and push to main: lint, format check, typecheck, unit, integration, build, `e2e` (`dev` project).
- After each successful Vercel deployment (GitHub `deployment_status`): `e2e:deployed` against that URL.
- `e2e:live`: manually (`workflow_dispatch`) — it costs API credits.
