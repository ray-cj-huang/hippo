# 0003 — Stream STT and LLM, chunk TTS by sentence

- Status: accepted
- Date: 2026-10-27

## Context

Token-streaming LLM output straight into TTS is fastest but leaves no place to stop an unsafe or ungrounded sentence before the caller hears it. Healthcare voice systems (e.g. Hippocratic AI's Polaris) check the primary model's output before speaking.

## Decision

STT and LLM stream. LLM text is cut into sentences; each sentence passes `Guardrail.check` and becomes its own Cartesia request (one context per sentence), so phoner knows exactly which sentences the caller heard when they barge in. Requests run one at a time by default (`TTS_MAX_CONCURRENCY`, the plan's concurrency limit); synthesis is faster than playback, so audio stays gapless. P1 uses `NoopGuardrail`.

## Consequences

- Adds the time to finish the first sentence (~100–200 ms) to first-audio latency.
- Prosody resets slightly at sentence boundaries (separate contexts); the trade buys exact heard-text tracking.
- Guardrails can be added later without touching the pipeline (see [guardrails.md](../guardrails.md)).
