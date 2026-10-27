# LLM tools

The LLM sees seven tools. Six are executed by the integrator over HTTP; `end_call` is handled inside phoner. Schemas live in `packages/contracts/src/tools.ts` and are the source for both the LLM tool declarations and integrator request validation.

## Tools

| Tool                     | Args                                                                   | Returns                                                                                                                       | Integrator endpoint                 |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `get_availability`       | `specialty`, `date` (YYYY-MM-DD, clinic TZ), `doctorId?`               | `slots[]`: `{ slotId, doctorId, doctorName, startAt, label }` (max 12)                                                        | `POST /availability`                |
| `verify_patient`         | `firstName`, `lastName`, `dob`, `callerConfirmed: true`, `newPatient?` | `{ status: "verified" \| "registered", patientId, firstName, lastName, upcomingAppointments[] }` or error `PATIENT_NOT_FOUND` | `POST /patients/verify`             |
| `book_appointment`       | `slotId`, `reason`, `confirmDuplicate?`                                | `{ appointmentId, doctorName, startAt, label }`                                                                               | `POST /appointments`                |
| `list_appointments`      | —                                                                      | `appointments[]`: `{ appointmentId, doctorName, specialty, startAt, label }`                                                  | `GET /patients/:id/appointments`    |
| `cancel_appointment`     | `appointmentId`                                                        | `{ appointmentId, status: "cancelled" }`                                                                                      | `POST /appointments/:id/cancel`     |
| `reschedule_appointment` | `appointmentId`, `slotId`                                              | `{ appointmentId, previousAppointmentId, doctorName, startAt, label }`                                                        | `POST /appointments/:id/reschedule` |
| `end_call`               | `reason?`                                                              | —                                                                                                                             | (phoner)                            |

`patientId` is **not** an LLM argument for `book_appointment`, `list_appointments`, `cancel_appointment` or `reschedule_appointment`. phoner injects the verified patient's ID from session state, so the LLM cannot act on behalf of another patient even if it hallucinates an ID.

`label` is a pre-formatted spoken form ("Wednesday, October 28th at 9:30 AM") so the LLM doesn't do timezone math.

## Gating

`ToolPolicy` (phoner) decides which tools are offered on each LLM request:

| Session state                                                            | Tools offered                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| Start                                                                    | `verify_patient`, `get_availability`, `end_call` |
| Patient verified                                                         | + `list_appointments`, `cancel_appointment`      |
| Patient verified **and** `get_availability` has returned slots this call | + `book_appointment`, `reschedule_appointment`   |

Enforced twice:

1. **phoner** — gated tools are not offered, and if the model calls one anyway it gets `PATIENT_NOT_IDENTIFIED` or `AVAILABILITY_REQUIRED` without reaching the integrator.
2. **integrator** — booking and rescheduling require a valid, unexpired, HMAC-signed `slotToken` that only `/availability` issues, and every appointment mutation checks ownership by `patientId`.

## slotToken

```
payload = { doctorId, startAt, exp }          // exp = now + 30 min
token   = base64url(payload) + "." + base64url(HMAC-SHA256(SLOT_TOKEN_SECRET, payload))
```

- Proves the slot came from an availability check (requirement F15) without server-side state.
- Expiry (30 min, about the length of a long call) stops stale tokens from being reused later; an expired token returns `AVAILABILITY_EXPIRED`.
- It does **not** reserve the slot; the database decides who wins ([concurrency.md](concurrency.md)).
- The LLM never sees it. phoner replaces each `slotToken` in tool results with a short `slotId` (`slot_1`, `slot_2`, …) and swaps the token back in when the model books or reschedules. In testing, Gemini mistyped one character of an 80-character token; short ids remove that failure mode without weakening the check.

## Tool results

The integrator reports **facts**; the LLM decides what to say and do next. Results never contain scripted lines for the caller. Every result has the same envelope (`ToolResult` in `@hippo/contracts`):

```ts
type ToolResult<T> =
  | { ok: true; data: T; message: string; warnings?: Warning[] }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; retryable: boolean; details?: object };
    };
```

- `message` is one or two plain sentences written for the LLM, not the caller. It always states **what changed and what didn't** ("No appointment was created.", "The original appointment is unchanged."), because the worst failure in a voice agent is telling a caller something happened when it didn't.
- `details` carries data the LLM can act on (alternatives with fresh `slotToken`s, the conflicting appointment, the valid booking window).
- `retryable` tells the LLM whether calling the same tool again with the same args can succeed.
- Times always come with a spoken `label` in clinic time so the LLM never does timezone math.

The system prompt holds the general policy for using these (offer alternatives, never claim success without `ok: true`, offer a callback after two failures). Tool gating ([above](#gating)) limits what the LLM can try next.

Example:

```json
{
  "ok": false,
  "error": {
    "code": "SLOT_TAKEN",
    "message": "Dr. Chen's 9:30 AM slot on Wednesday, October 28th was booked by another patient moments ago. No appointment was created.",
    "retryable": false,
    "details": {
      "alternatives": [
        {
          "slotToken": "…",
          "doctorName": "Dr. Lisa Chen",
          "label": "Wednesday, October 28th at 10:00 AM"
        },
        {
          "slotToken": "…",
          "doctorName": "Dr. Lisa Chen",
          "label": "Wednesday, October 28th at 10:30 AM"
        },
        {
          "slotToken": "…",
          "doctorName": "Dr. Sam Okafor",
          "label": "Wednesday, October 28th at 9:30 AM"
        }
      ]
    }
  }
}
```

## Edge cases

### get_availability

| Case                                                                                 | Result                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| No open slots that day (full, weekend, doctor off)                                   | `ok: true`, `slots: []`, `nextAvailable: { date, label }` searched forward within the window; message says the day has no openings |
| Date is today, in the past, or past the booking window                               | `OUTSIDE_BOOKING_WINDOW`, `details: { earliest, latest }` (labels)                                                                 |
| Unknown specialty or doctor                                                          | `UNKNOWN_SPECIALTY` / `UNKNOWN_DOCTOR`, `details.valid` lists the valid options                                                    |
| `doctorId` not in the given `specialty`                                              | `ok: true` using the doctor's actual specialty; `warnings: [DOCTOR_SPECIALTY_MISMATCH]`                                            |
| Specialty restricted by age (Pediatrics < 18) and the verified patient is outside it | `ok: true` with slots, `warnings: [AGE_RESTRICTED]`; booking will be rejected (see below)                                          |

### verify_patient

| Case                                                                                | Result                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Match                                                                               | `status: "verified"`, plus `upcomingAppointments[]` so the LLM knows about existing bookings before booking another |
| No match, `newPatient` not set                                                      | `PATIENT_NOT_FOUND`, message: "No patient record was found and none was created."                                   |
| `newPatient: true` but a match exists                                               | `ok: true`, `status: "verified"`, message notes the patient was already registered (no duplicate created)           |
| Implausible DOB (future, > 120 years ago) or empty name parts                       | `VALIDATION_ERROR`, `details.field`                                                                                 |
| `callerConfirmed` missing/false                                                     | `VALIDATION_ERROR` — the model must confirm the spelling and DOB first                                              |
| Names with accents, hyphens, apostrophes, extra spaces (José, Smith-Jones, O'Brien) | Normalized for matching (NFKD, case-fold, punctuation-insensitive), stored as spoken                                |

### book_appointment

| Case                                                                  | Result                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Success                                                               | `ok: true`, `{ appointmentId, doctorName, label }`, message: "Booked …"                                                                                                                |
| Slot booked by someone else first (race)                              | `SLOT_TAKEN`, `details.alternatives` (≤ 3, fresh tokens): same doctor same day, then same specialty same day, then next days                                                           |
| Token missing, malformed or signature invalid (model invented a slot) | `AVAILABILITY_REQUIRED`, message: "This time did not come from an availability check."                                                                                                 |
| Token expired (TTL 30 min)                                            | `AVAILABILITY_EXPIRED`, `retryable: false` — call `get_availability` again                                                                                                             |
| Slot start is now in the past (call ran long, or clock edge)          | `SLOT_IN_PAST`                                                                                                                                                                         |
| Doctor deactivated or schedule changed since availability             | `SLOT_UNAVAILABLE` + alternatives                                                                                                                                                      |
| Patient already has an appointment at that exact time (any doctor)    | `PATIENT_TIME_CONFLICT`, `details.existing` (doctor, label)                                                                                                                            |
| Patient already has an upcoming appointment in the same specialty     | `DUPLICATE_APPOINTMENT`, `details.existing`, `retryable: true` — if the caller wants both, call again with `confirmDuplicate: true`; if not, they likely want `reschedule_appointment` |
| Specialty age restriction (adult booking Pediatrics)                  | `AGE_RESTRICTED`, `details.suggestedSpecialty` (e.g. `family_medicine`)                                                                                                                |
| Same request retried (same `Idempotency-Key`)                         | Original response replayed, `replayed: true`; never a second booking or a `SLOT_TAKEN` against itself                                                                                  |
| Reason empty or very long                                             | Reason is optional at the DB level; trimmed to 200 chars                                                                                                                               |

### cancel_appointment

| Case                              | Result                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Success                           | `ok: true`, message: "Cancelled …; the slot is now free."                             |
| Already cancelled                 | `ok: true`, `alreadyCancelled: true` (idempotent; nothing changed)                    |
| Appointment in the past           | `APPOINTMENT_IN_PAST`                                                                 |
| Not this patient's, or unknown ID | `NOT_YOUR_APPOINTMENT` (same response for both, so IDs can't be probed)               |
| Less than 24 h away               | `ok: true`, `warnings: [LATE_CANCELLATION]` — the LLM may mention the clinic's policy |

### reschedule_appointment

| Case                                      | Result                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Success                                   | `ok: true`, `{ appointmentId, previousAppointmentId, label, previousLabel }`        |
| New slot taken                            | `SLOT_TAKEN` + alternatives, message: "The original appointment on … is unchanged." |
| New slot equals the current one           | `NO_CHANGE`                                                                         |
| Original already cancelled or in the past | `APPOINTMENT_NOT_ACTIVE` — suggest booking a new appointment instead                |
| Not this patient's                        | `NOT_YOUR_APPOINTMENT`                                                              |
| Token expired / invalid                   | `AVAILABILITY_EXPIRED` / `AVAILABILITY_REQUIRED`, original unchanged                |
| Different specialty than the original     | Allowed; `warnings: [SPECIALTY_CHANGED]`                                            |

### Failures between phoner and integrator

| Case                                                                    | What phoner returns to the LLM                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrator unreachable before sending                                   | `SERVICE_UNAVAILABLE`, `retryable: true`                                                                                                                                                                                                                  |
| **Booking/cancel/reschedule timed out after sending** (outcome unknown) | phoner retries once with the same `Idempotency-Key` (safe). If it still fails: `OUTCOME_UNKNOWN`, message: "It is not known whether the change was saved. Do not tell the caller it succeeded." The call is flagged for staff follow-up in `call_events`. |
| Integrator returns 5xx                                                  | `INTERNAL_ERROR`, `retryable: true` once                                                                                                                                                                                                                  |
| Barge-in while a tool is running                                        | The tool is not aborted; its result is recorded and given to the LLM on the next turn                                                                                                                                                                     |
| Caller hangs up mid-booking                                             | The booking stands; the call record links it (`appointments.call_id`)                                                                                                                                                                                     |

## Error codes

| Code                                   | From               | Retryable                     | Meaning                                                        |
| -------------------------------------- | ------------------ | ----------------------------- | -------------------------------------------------------------- |
| `SLOT_TAKEN`                           | integrator         | no                            | Another booking won the slot; alternatives included            |
| `SLOT_UNAVAILABLE`                     | integrator         | no                            | Slot no longer exists (schedule change); alternatives included |
| `SLOT_IN_PAST`                         | integrator         | no                            | Slot start time has passed                                     |
| `AVAILABILITY_REQUIRED`                | phoner, integrator | no                            | No valid `slotToken`, or availability not checked this call    |
| `AVAILABILITY_EXPIRED`                 | integrator         | no                            | `slotToken` older than 30 min                                  |
| `OUTSIDE_BOOKING_WINDOW`               | integrator         | no                            | Date outside tomorrow … +30 days                               |
| `PATIENT_NOT_IDENTIFIED`               | phoner             | no                            | Appointment tool before `verify_patient` succeeded             |
| `PATIENT_NOT_FOUND`                    | integrator         | no                            | No patient with that name + DOB                                |
| `PATIENT_TIME_CONFLICT`                | integrator         | no                            | Patient already booked at that time                            |
| `DUPLICATE_APPOINTMENT`                | integrator         | yes (with `confirmDuplicate`) | Patient already has an upcoming appointment in that specialty  |
| `AGE_RESTRICTED`                       | integrator         | no                            | Specialty doesn't see patients of this age                     |
| `NOT_YOUR_APPOINTMENT`                 | integrator         | no                            | Not the verified patient's appointment, or doesn't exist       |
| `APPOINTMENT_IN_PAST`                  | integrator         | no                            | Can't cancel a past appointment                                |
| `APPOINTMENT_NOT_ACTIVE`               | integrator         | no                            | Already cancelled or past; can't reschedule                    |
| `NO_CHANGE`                            | integrator         | no                            | Reschedule target equals the current slot                      |
| `UNKNOWN_SPECIALTY` / `UNKNOWN_DOCTOR` | integrator         | no                            | Not in the clinic directory; valid options included            |
| `VALIDATION_ERROR`                     | phoner, integrator | no                            | Malformed args; `details.field`                                |
| `SERVICE_UNAVAILABLE`                  | phoner             | yes                           | Integrator unreachable; nothing was sent                       |
| `OUTCOME_UNKNOWN`                      | phoner             | no                            | A change may or may not have been saved                        |
| `INTERNAL_ERROR`                       | integrator         | yes (once)                    | Unexpected failure                                             |

Warnings (`ok: true` but worth mentioning): `DOCTOR_SPECIALTY_MISMATCH`, `AGE_RESTRICTED`, `LATE_CANCELLATION`, `SPECIALTY_CHANGED`.

## Recording and idempotency

phoner sends two headers with every tool request:

| Header            | Value                                               |
| ----------------- | --------------------------------------------------- |
| `X-Call-Id`       | the call's id (from `POST /calls` at session start) |
| `Idempotency-Key` | the LLM tool-call id                                |

Every request is logged in `integration_calls` (see [data-model.md](data-model.md#integration_calls)). Mutating tools also claim an `idempotency_keys` row keyed by `(call id, tool-call id, tool)`:

| Existing key                 | Response                                       |
| ---------------------------- | ---------------------------------------------- |
| none                         | run the request                                |
| completed, same request      | stored response with `replayed: true`          |
| completed, different request | `VALIDATION_ERROR` (422)                       |
| in progress, lease fresh     | `SERVICE_UNAVAILABLE` (409, `retryable: true`) |
| in progress, lease expired   | take over and run                              |

`X-Call-Id` is required whenever `Idempotency-Key` is sent. phoner generates the call id at session start, so it is always present.

Appointment changes also write `appointment_events` linked to the `integration_calls` row, giving each appointment a full history.

## Call log endpoints

Not LLM tools; phoner uses them so it never needs a database connection.

| Endpoint                                                        | Purpose                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /calls` `{ llmProvider, llmModel }` → `{ callId }`        | start of call                                                    |
| `POST /calls/:id/events` `{ events: [{ type, payload, at? }] }` | transcript turns, barge-ins, errors, staff flags (`call_events`) |
| `POST /calls/:id/end` `{ reason }`                              | end of call                                                      |
