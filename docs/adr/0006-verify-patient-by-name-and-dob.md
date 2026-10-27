# 0006 — Identify patients by name + DOB with spoken confirmation

- Status: accepted
- Date: 2026-10-27

## Context

Name is the requested identifier, but names collide (two John Smiths) and STT mishears spellings.

## Decision

Identity = normalized first name + last name + DOB, unique in the DB. The agent spells the name back letter by letter and repeats the DOB; `verify_patient` requires `callerConfirmed: true`. Registration of a new patient happens only on a second call with `newPatient: true` after the caller says they're new. After verification the patient is bound to the call, and the integrator takes `patientId` from the call record — neither the LLM nor the HTTP request supplies it ([ADR 0009](0009-integrator-trusts-the-call.md)).

## Consequences

- An extra 10–20 s of conversation per call; much lower risk of acting on the wrong record.
- No duplicate registrations from a single misheard letter.
- A third identifier (phone, MRN) can be added later without changing the flow.
