---

name: add-provider
description: Add or swap an LLM, speech-to-text, text-to-speech or guardrail provider in phoner via the factory pattern. Use when integrating a new vendor (e.g. another LLM, STT or TTS service) or changing provider configuration.
---

# Add a provider

Pipeline code (`apps/phoner/src/pipeline/`) depends only on interfaces. A provider is one class plus one factory case.

| Kind      | Interface                                   | Factory                            |
| --------- | ------------------------------------------- | ---------------------------------- |
| LLM       | `apps/phoner/src/providers/llm/provider.ts` | `providers/llm/create.ts`          |
| STT       | `providers/stt/provider.ts`                 | `providers/stt/create.ts`          |
| TTS       | `providers/tts/provider.ts`                 | `providers/tts/create.ts`          |
| Guardrail | `providers/guardrail/guardrail.ts`          | `createGuardrail` in the same file |

Steps:
1. Implement the interface in `providers/<kind>/<vendor>.ts`. Import the vendor SDK only there.
2. Add the value to the zod enum and any keys/options in `apps/phoner/src/config.ts` (the `superRefine` makes required keys fail fast), then a `case` in the factory; the exhaustive switch fails typecheck if you forget.
3. Add the variables to `.env.example`.
4. LLM providers: map provider-neutral `LlmMessage`s both ways, keep provider-native content in `AssistantMessage.raw` (thought signatures / thinking blocks must be replayed verbatim), honor the `AbortSignal`, and yield `{ type: "done" }` with all tool calls. Decide whether to filter tools by `allowedTools` (Gemini does) or send all; if a vendor invalidates earlier reasoning when the tool list changes, send all and rely on `checkTool`.
5. Smoke-test against the real API with a throwaway script, then delete it. Check vendor wire formats in their current docs rather than from memory.
6. Document it in `docs/providers.md`.

Verify: `pnpm --filter @hippo/phoner typecheck && pnpm --filter @hippo/phoner test`, then a text-only call in the console (`pnpm dev`).
