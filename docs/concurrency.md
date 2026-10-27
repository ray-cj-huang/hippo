# Concurrency: many callers, one slot

## The problem

Two callers hear "Dr. Chen has 9:30" at the same moment and both say yes. Only one can have it. The loser's agent must find out immediately and offer something else, without ever telling the caller they were booked.

## Design: the database is the only arbiter

No locks in application memory, no "check then insert" in code. A partial unique index makes a double booking impossible:

```sql
CREATE UNIQUE INDEX appointments_doctor_slot_booked_uq
  ON appointments (doctor_id, start_at)
  WHERE status = 'booked';
```

Booking is a single statement:

```sql
INSERT INTO appointments (patient_id, doctor_id, start_at, status, reason, call_id)
VALUES ($1, $2, $3, 'booked', $4, $5)
ON CONFLICT DO NOTHING
RETURNING id;
```

No conflict target, so a violation of either partial unique index (doctor double-booked, or patient already booked at that time) becomes "no row" instead of an exception.

- One row returned → booked.
- Zero rows → someone else holds it → `SLOT_TAKEN`, and the integrator computes up to three nearest open slots (same specialty, same day first, then next days) with fresh `slotToken`s.

Because the index is partial, a **cancelled** appointment frees the slot automatically.

### Why this is enough

- Postgres guarantees uniqueness under concurrent inserts: the second inserter waits on the first's index entry, then sees the conflict.
- It works across any number of integrator replicas and both Supavisor pool modes (no session state, no advisory locks).
- It's one round trip; no retries or serializable transactions needed.

## Reschedule

Must never leave the patient with zero or two appointments:

```
BEGIN;
  UPDATE appointments SET status='cancelled'
    WHERE id=<old id> AND status='booked';                        -- 0 rows → ROLLBACK, APPOINTMENT_NOT_ACTIVE
  INSERT new appointment ... ON CONFLICT DO NOTHING RETURNING id;  -- conflict → ROLLBACK, SLOT_TAKEN (original kept)
  UPDATE appointments SET rescheduled_to=<new id> WHERE id=<old id>;
  INSERT appointment_events (rescheduled_out, rescheduled_in);
COMMIT;
```

The old row is cancelled first so that moving to the same time with a different doctor doesn't collide with the patient's own still-booked appointment (`unique (patient_id, start_at)`). If the insert conflicts, the rollback restores the original.

## Same patient, double booking themselves

A patient may hold multiple appointments (different doctors, different days). The integrator rejects a booking that overlaps another `booked` appointment for the same patient at the same `start_at` (`unique (patient_id, start_at) where status='booked'`), returned as `SLOT_TAKEN` with alternatives.

## Availability "must be called first"

Availability is a read; it doesn't reserve anything. `slotToken` (see [tools.md](tools.md#slottoken)) proves the slot was offered by `/availability` and is still fresh (30 min). It prevents the LLM from inventing times and enforces requirement F15 server-side. It intentionally does **not** hold the slot: holds add expiry cleanup and let abandoned calls block real patients.

## Retries

Each mutating request carries `Idempotency-Key` (the LLM tool-call ID) and `X-Call-Id`. The integrator claims an `idempotency_keys` row for `(call, tool call, tool)` and writes the response into it in the same transaction as the booking, so a retry replays exactly what happened instead of booking twice or hitting `SLOT_TAKEN` against itself. See [ADR 0007](adr/0007-idempotency-keys.md).

## Future: holds

If analytics show callers often lose races (popular doctors, high call volume), add soft holds: `get_availability` with `hold: true` writes a `slot_holds` row (TTL 2 min) for the slot the agent is about to read back; other callers' availability excludes held slots. The unique index remains the final guard.

## Tests

- Integration: 20 parallel `POST /appointments` with the same token → exactly 1 success, 19 `SLOT_TAKEN`.
- Integration: reschedule into a taken slot leaves the original appointment intact.
- E2E: two browser contexts book the same slot; one sees the success, the other sees `SLOT_TAKEN` and the agent offers alternatives.
