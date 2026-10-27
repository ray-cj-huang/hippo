---

name: e2e-scenario
description: Write or update a Playwright end-to-end test for a Hippo call flow using a scripted agent scenario. Use when a call flow, tool, or console behavior changes and needs a deterministic e2e test.
---

# Write an e2e scenario

E2E runs the real web, phoner and integrator with `LLM_PROVIDER=scripted`, `STT_PROVIDER=none`, `TTS_PROVIDER=silent` (see `apps/e2e/playwright.config.ts`). The caller types; the agent follows a script.

1. Add `apps/e2e/scenarios/<name>.yaml`: one list of agent steps per caller turn.

   ```yaml
   turns:
     - - tool: get_availability
         args: { specialty: dermatology, date: "$date.nextTuesday" }
       - say: Dr. Lee has an opening. Shall I book it?
     - - tool: book_appointment
         args: { slotId: "$get_availability.slots.0.slotId", reason: rash }
   ```

   `$<tool>.<path>` reads the latest result of that tool; `$date.next<Weekday>` is the next such day in clinic time. Tool calls hit the real integrator, so outcomes (errors, races) are real.
2. Add a spec in `apps/e2e/tests/` using `startCall`, `say` and `tool` from `tests/helpers.ts`. Assert on `data-status` of tool calls, DB panel rows and call status, not on exact agent wording.
3. The DB is reset and seeded once per run (`global-setup.ts`); pick a specialty/date no other spec books to avoid cross-test collisions.
4. Multi-caller tests: one `browser.newContext()` per caller.

Run: `docker compose up -d db && pnpm e2e` (add `--headed` or `--ui` via `pnpm --filter @hippo/e2e exec playwright test --ui`).
