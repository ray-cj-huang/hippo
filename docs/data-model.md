# Data model

Defined with Drizzle in `packages/db/src/schema.ts`; migrations in `packages/db/drizzle/`. All timestamps are `timestamptz` in UTC; local clinic time is derived using `CLINIC_TIMEZONE`.

```
specialties 1───* doctors 1───* doctor_schedules
                     │
                     └──* appointments *───1 patients
                              │
                              └──* appointment_events *───1 integration_calls
calls 1───* call_events                                        │
calls 1───* integration_calls ─────────────────────────────────┘
idempotency_keys (call_id, tool_call_id, tool) ──► integration_calls
```

Every table has row-level security enabled with no policies. Our services connect as `postgres`, which bypasses RLS, while Supabase's auto-generated REST API (anon/authenticated roles) sees nothing. Without this, anyone with the project's public anon key could read patients.

## Tables

### specialties

| Column           | Type              | Notes                                                                        |
| ---------------- | ----------------- | ---------------------------------------------------------------------------- |
| id               | text PK           | slug, e.g. `orthopedics` — used directly as the LLM `specialty` arg          |
| name             | text              | "Orthopedics"                                                                |
| is_primary_care  | boolean           | Family Medicine, Internal Medicine, Pediatrics                               |
| min_age, max_age | smallint nullable | age limits, e.g. Pediatrics `max_age = 17`, Internal Medicine `min_age = 18` |

### doctors

| Column                | Type    | Notes                                                                  |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| id                    | uuid PK |                                                                        |
| specialty_id          | text FK |                                                                        |
| first_name, last_name | text    |                                                                        |
| title                 | text    | "Dr."                                                                  |
| active                | boolean | inactive doctors are hidden from the clinic directory and availability |

### doctor_schedules

| Column               | Type     | Notes                                                             |
| -------------------- | -------- | ----------------------------------------------------------------- |
| id                   | uuid PK  |                                                                   |
| doctor_id            | uuid FK  |                                                                   |
| weekday              | smallint | 0 = Sunday … 6 = Saturday                                         |
| start_time, end_time | time     | local clinic time; slots generated every 30 min in `[start, end)` |

### patients

| Column                          | Type        | Notes                                                                          |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| id                              | uuid PK     |                                                                                |
| first_name, last_name           | text        | as confirmed by the caller (display form)                                      |
| first_name_norm, last_name_norm | text        | trimmed, lowercased, NFKD with diacritics stripped, inner whitespace collapsed |
| dob                             | date        |                                                                                |
| created_at, updated_at          | timestamptz |                                                                                |

Unique: `(last_name_norm, first_name_norm, dob)`.

### appointments

| Column                 | Type                         | Notes                               |
| ---------------------- | ---------------------------- | ----------------------------------- |
| id                     | uuid PK                      |                                     |
| patient_id             | uuid FK                      |                                     |
| doctor_id              | uuid FK                      |                                     |
| start_at               | timestamptz                  | aligned to :00/:30 local            |
| status                 | enum `booked` \| `cancelled` |                                     |
| reason                 | text                         | caller's words, short               |
| rescheduled_to         | uuid nullable                | set on the old row when rescheduled |
| created_at, updated_at | timestamptz                  |                                     |

Indexes:

- `unique (doctor_id, start_at) where status = 'booked'` — the double-booking guard ([concurrency.md](concurrency.md)).
- `unique (patient_id, start_at) where status = 'booked'` — a patient can't be in two places at once.
- `(patient_id, start_at)` for listing.

### calls

Written through the integrator's `/calls` endpoints; phoner never connects to the database.

| Column                  | Type             | Notes                                |
| ----------------------- | ---------------- | ------------------------------------ |
| id                      | uuid PK          |                                      |
| started_at, ended_at    | timestamptz      |                                      |
| patient_id              | uuid FK nullable | set once verified                    |
| llm_provider, llm_model | text             | for later analysis                   |
| end_reason              | text             | `caller_hangup`, `end_call`, `error` |

### call_events

| Column  | Type         | Notes                                                                      |
| ------- | ------------ | -------------------------------------------------------------------------- |
| id      | bigserial PK |                                                                            |
| call_id | uuid FK      |                                                                            |
| at      | timestamptz  |                                                                            |
| type    | text         | `user_turn`, `agent_turn`, `tool_call`, `tool_result`, `barge_in`, `error` |
| payload | jsonb        | transcript text, tool args/results, latency ms                             |

### integration_calls

Audit log: one row per tool request the integrator handles, reads, retries and failures included. The row is inserted when the request arrives and completed when it returns; rows are never deleted. Duplicate protection lives in [idempotency_keys](#idempotency_keys), not here.

| Column                   | Type             | Notes                                                                    |
| ------------------------ | ---------------- | ------------------------------------------------------------------------ |
| id                       | uuid PK          |                                                                          |
| call_id                  | uuid FK nullable | from the `X-Call-Id` header                                              |
| tool_call_id             | text nullable    | the LLM tool-call id (`Idempotency-Key` header)                          |
| tool                     | text             | `get_availability`, `verify_patient`, `book_appointment`, …              |
| patient_id               | uuid FK nullable | from the request, or the result of `verify_patient`                      |
| request                  | jsonb            | params + body                                                            |
| response                 | jsonb            | the `ToolResult` returned                                                |
| http_status              | smallint         | null while in flight                                                     |
| ok                       | boolean          | `response.ok`                                                            |
| error_code               | text nullable    | e.g. `SLOT_TAKEN`                                                        |
| replay_of                | uuid nullable    | on a replayed retry, the `integration_calls` row of the original attempt |
| latency_ms               | integer          |                                                                          |
| started_at, completed_at | timestamptz      |                                                                          |

Indexes:

- `(call_id, started_at)`, `(patient_id, started_at)`, `(error_code, started_at)` for "what happened on this call", "everything done for this patient", and "how often do bookings lose races".

Examples:

```sql
-- Every action the agent took on a call
select started_at, tool, ok, error_code, latency_ms from integration_calls where call_id = $1 order by started_at;
-- Race losses per day
select date_trunc('day', started_at), count(*) from integration_calls where error_code = 'SLOT_TAKEN' group by 1;
```

### idempotency_keys

Makes retries of mutating tools (`verify_patient`, `book_appointment`, `cancel_appointment`, `reschedule_appointment`) safe. Rows older than 24 h (by `created_at`) are purged hourly by the integrator.

| Column                      | Type                              | Notes                                                                              |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| call_id, tool_call_id, tool | PK                                | scoped to the call, so two calls can never share a stored response                 |
| request_hash                | text                              | sha256 of the canonical request; a reused key with a different request is rejected |
| status                      | enum `in_progress` \| `completed` |                                                                                    |
| locked_until                | timestamptz                       | 30 s lease; an expired lease means the holder died and the key can be taken over   |
| http_status, response       |                                   | the stored result replayed to retries                                              |
| integration_call_id         | uuid FK                           | the attempt that produced the response                                             |
| created_at, updated_at      | timestamptz                       |                                                                                    |

Booking, cancelling and rescheduling write `completed` and the response in the same transaction as the appointment change, so a stored response always matches what happened. A 5xx means the transaction rolled back, and the key is deleted so the retry runs for real. See [ADR 0007](adr/0007-idempotency-keys.md).

### appointment_events

Append-only history of appointment state changes, written in the same transaction as the change so it can't drift from `appointments`.

| Column              | Type                                                                  | Notes                                                                                    |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| id                  | bigserial PK                                                          |                                                                                          |
| appointment_id      | uuid FK                                                               |                                                                                          |
| type                | enum `booked` \| `cancelled` \| `rescheduled_out` \| `rescheduled_in` | a reschedule writes `rescheduled_out` on the old row and `rescheduled_in` on the new one |
| integration_call_id | uuid FK nullable                                                      | the request that caused it                                                               |
| call_id             | uuid FK nullable                                                      | the phone call it happened in                                                            |
| at                  | timestamptz                                                           |                                                                                          |
| details             | jsonb                                                                 | e.g. `{ "to": <new id> }` / `{ "from": <old id> }`                                       |

## Seed

`pnpm db:seed` (local only; refuses other hosts) loads: 8 specialties (Family Medicine, Internal Medicine, Pediatrics, Orthopedics, Cardiology, Dermatology, OB/GYN, ENT), 1–2 doctors each, Mon–Fri 9:00–17:00 schedules, and three demo patients (including two John Smiths with different DOBs to exercise the tiebreaker). IDs are fixed so tests and e2e scenarios can reference them.

## Slot computation

For a date and specialty (optionally a doctor):

1. Doctors in the specialty with a schedule on that weekday.
2. Candidate starts every 30 min in `[start_time, end_time)`, converted from local to UTC.
3. Minus `booked` appointments for those doctors on that date.
4. Minus anything before the booking window start.
5. Sorted by time, then doctor; capped at 12; each gets a `slotToken`.
