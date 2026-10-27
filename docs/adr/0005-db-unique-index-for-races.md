# 0005 — Partial unique index resolves booking races

- Status: accepted
- Date: 2026-10-27

## Context

Several callers can try to book the same doctor and time concurrently. Application-level locks don't work across replicas and are easy to get wrong.

## Decision

`unique (doctor_id, start_at) where status = 'booked'` plus `INSERT … ON CONFLICT DO NOTHING RETURNING id`. No row → `SLOT_TAKEN` with alternatives. Reschedule = insert new + cancel old in one transaction.

## Consequences

- Correct under any concurrency with one round trip.
- Compatible with Supabase transaction pooling (no session state).
- Losers find out only at booking time; if that happens often we add soft holds (see [concurrency.md](../concurrency.md#future-holds)).
