# 0007 — Call-scoped idempotency keys, completed in the change's transaction

- Status: accepted
- Date: 2026-10-27

## Context

Retries of mutating tools must never double-book or leak data. The first draft put a partial unique index on `integration_calls (tool_call_id, tool)`, which had three gaps:

1. Keys weren't scoped to a call. Scripted e2e calls reuse tool-call ids, so one call could replay another patient's stored response.
2. The response was written after the booking committed, in a separate statement. A failure in between returned a 5xx, freed the key and let the retry book again.
3. Rows left "in flight" by a crashed process blocked their key forever.

## Decision

- A separate `idempotency_keys` table, primary key `(call_id, tool_call_id, tool)`, with `request_hash`, `status`, a 30 s `locked_until` lease and the stored response.
- Claim: insert on conflict do nothing; on conflict lock the row and replay (completed, same hash), reject (different hash), return 409 (fresh lease) or take over (expired lease).
- Mutating services complete the key inside the transaction that changes the appointment. A 5xx therefore means nothing was saved, and the key is released.
- `integration_calls` becomes a plain append-only audit log.
- phoner generates the call id and always sends `X-Call-Id`; it is required whenever `Idempotency-Key` is sent.

## Implementation

- `packages/db/src/schema.ts` — `idempotencyKeys`.
- `apps/integrator/src/idempotency.ts` — `claimKey`, `completeKey`, `releaseKey`, `purgeIdempotencyKeys`.
- `apps/integrator/src/integration-calls.ts` — middleware: audit row, claim, replay.
- `apps/integrator/src/services/appointments.ts` — `completeKey(tx, …)` in book, cancel and reschedule.

## Verification

- [x] `apps/integrator/test/integration/idempotency.test.ts`: same-call replay, cross-call isolation, request mismatch, fresh-lease 409, expired-lease takeover, completion in the booking transaction.

## Consequences

- One extra insert per mutating request; reads skip idempotency entirely.
- A request that hangs past the 30 s lease can be taken over and run twice; the unique indexes on `appointments` still prevent a double booking.
