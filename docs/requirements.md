# Requirements

## Problem

Patients call a single medical center to book, change or check appointments. The center has doctors across several specialties. Callers may ask for a specific doctor, a specialty, or only describe a reason ("I think I broke my ankle"). A voice agent should handle these calls end to end without a human.

## Functional requirements (P1)

### Calls

- F1. A caller can start a call from the web console (browser mic stands in for a phone line in P1).
- F2. The agent speaks first with a short greeting and asks how it can help.
- F3. The caller can interrupt the agent at any time (barge-in); the agent stops speaking and listens.
- F4. The agent can end the call after a goodbye (`end_call`).

### Patient identity

- F5. Patients are identified by **first name + last name + date of birth**.
- F6. Before any lookup the agent spells the name back letter by letter and repeats the DOB, and the caller confirms.
- F7. If no patient matches, the agent re-confirms the spelling once, then asks whether the caller is a new patient; if yes, it registers them.
- F8. Booking, listing, cancelling and rescheduling are only possible after the patient is verified in the current call.

### Finding the right doctor

- F9. The clinic directory (specialties, doctors, hours) is known to the agent at call start.
- F10. If the caller names a doctor or specialty, use it.
- F11. If the caller gives a reason, map it to a specialty when the match is clear; otherwise route to primary care (Family Medicine, or Pediatrics for patients under 18).
- F12. Emergency red flags (chest pain, stroke signs, trouble breathing, severe bleeding, suicidal thoughts) → tell the caller to hang up and call 911 (or 988 for a mental health crisis). Do not book.
- F13. The agent never diagnoses or gives medical advice.

### Appointments

- F14. All appointments are 30 minutes, starting on the hour or half hour, inside the doctor's working hours.
- F15. `get_availability` must be called before `book_appointment` or `reschedule_appointment`; booking requires a `slotToken` that only availability returns.
- F16. Operations: book, cancel, reschedule, list upcoming appointments.
- F17. If a slot is taken between availability and booking (another caller won), the agent says so and offers the nearest alternatives.
- F18. The agent reads back the doctor, date and time and gets a yes before booking, cancelling or rescheduling.

### Console (web)

- F19. Live panels: transcript (partial + final), agent responses (as spoken), tool calls (args, result, latency, errors), database (doctors, patients, appointments).
- F20. No authentication in P1.

## Non-functional requirements

- N1. **Latency**: target < 1.2 s from end of caller speech to first agent audio (p50), < 2 s p95. See the budget in [architecture.md](architecture.md#latency-budget).
- N2. **Correctness under concurrency**: two callers can never hold the same doctor/time. Enforced by the database, not by the LLM.
- N3. **Provider independence**: LLM, STT and TTS providers are swappable by configuration (Factory Method).
- N4. **Safety hook**: every sentence the agent says passes through a guardrail interface before TTS. P1 ships a pass-through; see [guardrails.md](guardrails.md).
- N5. **Auditability**: every call stores its transcript and tool calls (`calls`, `call_events`).
- N6. **Privacy**: tools only ever return data for the verified patient of the current call. No PHI in logs beyond IDs.
- N7. **Testability**: the full call loop runs in CI with scripted providers (no API keys, no audio).

## Out of scope for P1

- Real phone lines (Twilio / SIP). The `CallTransport` interface leaves room for it.
- Insurance, referrals, copays.
- Guardrail models (designed, not built).
- Auth for the console; staff tools.
- Reminders/notifications, waitlists, multi-location.
- Languages other than English.
