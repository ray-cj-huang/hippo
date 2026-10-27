# 0004 — Signed slot tokens enforce availability-before-booking

- Status: accepted
- Date: 2026-10-27

## Context

The agent must check availability before booking, and must not book times it invented. Prompt instructions alone are not enforcement.

## Decision

`/availability` returns each slot with an HMAC-signed, 30-minute `slotToken` (`doctorId`, `startAt`, `exp`). `/appointments` and `/reschedule` accept only a token, not a raw doctor/time. phoner also hides booking tools until availability has returned this call.

## Consequences

- Stateless enforcement; works across replicas.
- Tokens don't reserve slots — races are resolved by the database (ADR 0005).
- Long pauses (> 30 min) require a fresh availability check.
- The LLM sees short `slotId`s; phoner maps them to tokens per call, because models mistype long tokens.
