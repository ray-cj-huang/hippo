# Providers (Factory Method)

phoner depends on interfaces, never on vendor SDKs directly. Each vendor is one class; a factory picks the class from validated config. This is the [Factory Method](https://refactoring.guru/design-patterns/factory-method) pattern: callers ask for "an LLM provider" and get a concrete product without knowing which.

```
apps/phoner/src/providers/
  llm/        provider.ts · google.ts · anthropic.ts · scripted.ts · create.ts
  stt/        provider.ts · deepgram-flux.ts · none.ts · create.ts
  tts/        provider.ts · cartesia.ts · silent.ts · create.ts
  guardrail/  guardrail.ts (interface, NoopGuardrail, createGuardrail)
```

## Interfaces (abridged)

```ts
interface LlmProvider {
  readonly name: string;
  streamTurn(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<LlmStreamEvent>;
}

type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: ToolName; args: unknown }
  | { type: "done"; stopReason: "end_turn" | "tool_use" | "max_tokens" };

interface SttProvider {
  connect(handlers: SttHandlers): Promise<SttStream>; // SttStream: sendAudio(frame), close()
}
// SttHandlers: onStartOfTurn, onUpdate(text), onEndOfTurn(text), onEagerEndOfTurn?, onTurnResumed?, onError

interface TtsProvider {
  startContext(handlers: TtsHandlers): TtsContext; // TtsContext: push(text), finish(), cancel()
}

interface Guardrail {
  check(chunk: string, context: GuardrailContext): Promise<GuardrailVerdict>;
}
```

Messages are provider-neutral (`{ role: "user" | "assistant" | "tool", ... }`). Each provider maps them to its own wire format (Gemini `contents`/`functionDeclarations`, Anthropic `messages`/`tools`), and maps tool JSON schemas from `@hippo/contracts` (zod → JSON Schema).

## Factory

```ts
export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case "google":
      return new GoogleLlmProvider(config);
    case "anthropic":
      return new AnthropicLlmProvider(config);
    case "scripted":
      return new ScriptedLlmProvider(config);
  }
}
```

`config.provider` is a zod enum, so the switch is exhaustive at compile time; adding a value without a case fails `pnpm typecheck`.

## Adding a provider

1. Implement the interface in a new file.
2. Add the enum value to the config schema and a case to the factory.
3. Add a contract test in `providers/<kind>/__tests__/` (the same suite runs against every provider using recorded fixtures).
4. Document required env vars in `.env.example`.

No other code changes: `CallSession` only sees the interface.

## Current providers

| Kind      | Name            | Notes                                                                                                                                         |
| --------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM       | `google`        | Gemini Flash Lite 3.5 via `@google/genai`, streaming + function calling. Default.                                                             |
| LLM       | `anthropic`     | Claude Haiku 5.5 via `@anthropic-ai/sdk`, streaming + tool use.                                                                               |
| LLM       | `scripted`      | Replays a scenario file; used by e2e and unit tests.                                                                                          |
| STT       | `deepgram-flux` | `/v2/listen`, `flux-general-en`, linear16 16 kHz.                                                                                             |
| STT       | `none`          | Ignores audio; caller turns arrive as typed `user.text`. Used by e2e and the console's text-only mode.                                        |
| TTS       | `cartesia`      | WebSocket; one context per sentence so playback can be tracked; concurrency capped by `TTS_MAX_CONCURRENCY` (plan limit). `pcm_s16le` 24 kHz. |
| TTS       | `silent`        | Emits short silent PCM per sentence; used by e2e.                                                                                             |
| Guardrail | `noop`          | Always allows. P1 default.                                                                                                                    |

Transports follow the same pattern (`createCallTransport`: `browser-ws` now, `twilio` later).
