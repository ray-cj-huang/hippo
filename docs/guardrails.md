# Guardrails (P2 design)

**Status:** P1 ships the hook (`Guardrail` interface, sentence-chunked TTS) with a pass-through `NoopGuardrail`. This doc is the design for the real checks.

## Why chunked TTS

Streaming LLM tokens directly into TTS gives the lowest latency but leaves no point to stop a bad sentence before the caller hears it. We stream the LLM, cut its output into sentences, check each sentence, then send it to TTS. The cost is the time to complete the first sentence (~100–200 ms of tokens), which the latency budget absorbs.

## How this compares to Hippocratic AI

Hippocratic AI's Polaris is a "constellation": a primary conversational model plus many specialist support models (medication, labs, nutrition, escalation) and verifiers that check the primary's output, all inside the realtime budget. Their engineering posts describe moving from single-model prototypes to treating safety as a system property, with supervisors able to intervene before speech.

Our design matches the shape — **primary agent + checks before speaking** — at a much smaller scale:

| Polaris                                | Hippo                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Primary conversational LLM             | Gemini Flash Lite / Claude Haiku via `LlmProvider`                                                       |
| Specialist support models              | Tools backed by deterministic business logic (integrator) — scheduling doesn't need clinical specialists |
| Supervisor / verifier models on output | `Guardrail` per sentence (P2: rules + small supervisor model)                                            |
| Clinical-grade ASR                     | Deepgram Flux                                                                                            |

Sources: [Polaris paper (arXiv 2403.13313)](https://arxiv.org/abs/2403.13313), [Hippocratic AI: Voice, Safety, and Latency](https://hippocraticai.com/building-ai-for-healthcare-conversations-part-2/).

## Checks (P2)

Layered, cheapest first. Each returns `allow`, `rewrite(text)` or `block(reason)`.

1. **Rules (≈1 ms)**
   - **Unverified claims**: sentence says booked/cancelled/rescheduled but no successful matching tool result in this turn → block.
   - **Medical advice**: dosage patterns, "you should take", "it's probably", diagnosis phrasing → replace with a safe deflection.
   - **PHI leakage**: names, DOBs or appointment details not belonging to the verified patient (compare against session state) → block.
   - **Time/doctor grounding**: any time or doctor name spoken must appear in the latest tool results or the clinic directory → block otherwise.
2. **Supervisor model (100–250 ms, P2b)** — a small fast model with a narrow rubric (medical advice? emergency missed? unsafe reassurance?) run on each sentence. Runs in parallel with TTS of the _previous_ sentence to hide latency.
3. **Conversation-level monitor (async)** — reviews each full turn for missed emergency signals; can inject a system note into the next turn ("caller mentioned chest pain; advise 911").

On `block`, the turn is aborted and the agent says a fixed safe line ("Sorry, let me rephrase that.") while the LLM is re-prompted with the violation.

## Interface

```ts
interface Guardrail {
  check(chunk: string, context: GuardrailContext): Promise<GuardrailVerdict>;
}
type GuardrailVerdict =
  | { action: "allow" }
  | { action: "rewrite"; text: string; reason: string }
  | { action: "block"; reason: string };
```

`GuardrailContext` carries the verified patient, the clinic directory, and this turn's tool results. Guardrails compose (`CompositeGuardrail([rules, supervisor])`) and are created by `createGuardrail(config)`.
