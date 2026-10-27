# Architecture

## System overview

```
                         ┌──────────────────────────── apps/web (Next.js, Vercel) ───────────────────────────┐
                         │  Call console: Start/End · Transcript · Agent responses · Tool calls · DB panel  │
                         └───────┬─────────────────────────────────────────────────────────┬────────────────┘
                     WebSocket   │ PCM16 16 kHz mic frames ↑↓ agent audio + JSON events     │ HTTP (read-only)
                                 ▼                                                          ▼
┌──────────────────────── apps/phoner (Node + ws) ────────────────────────┐   ┌──── apps/integrator (Node + Hono) ────┐
│ CallSession (one per call)                                                 │   │ /clinic  /availability                 │
│                                                                            │   │ /patients/verify                      │
│  CallTransport ──► SttProvider ──► TurnManager ──► LlmProvider ──┐         │   │ /appointments (+cancel, reschedule)   │
│   (browser ws)     (Deepgram Flux)  (state machine)  (Gemini)    │         │   │ /admin/* (console reads)              │
│        ▲                                                         ▼         │   │                                       │
│        │                                    ToolPolicy ──► IntegratorClient├──►│ zod validation · slotToken HMAC       │
│        │                                                         │         │   │ business rules · error codes          │
│        │                                              SentenceChunker      │   └──────────────────┬────────────────────┘
│        │                                                         ▼         │                      │ drizzle / postgres-js
│        └──────────── TtsProvider ◄──────────────────────── Guardrail       │                      ▼
│                      (Cartesia)                              (noop in P1)  │        ┌──── Supabase Postgres ────┐
└────────────────────────────────────────────────────────────────────────────┘        │ packages/db schema        │
                                                                                      │ unique(doctor,start)      │
                                                                                      │   where status='booked'   │
                                                                                      └───────────────────────────┘
```

Shared code lives in `packages/`:

- `@hippo/contracts` — zod schemas for tool inputs/outputs, error codes, and the WebSocket protocol. The single source of truth all three apps import.
- `@hippo/db` — Drizzle schema, migrations, seed, client.
- `@hippo/ui` — shadcn/ui components and Tailwind styles for the console.
- `@hippo/tsconfig` — shared TypeScript configs.

## Why two backend services

| phoner                                                            | integrator                        |
| ----------------------------------------------------------------- | --------------------------------- |
| Long-lived WebSocket per call, audio, streaming, latency-critical | Short request/response HTTP       |
| Stateful (call state, history, turn state)                        | Stateless                         |
| Scales with concurrent calls                                      | Scales with tool-call rate        |
| Talks to AI vendors                                               | Talks to the database             |
| Knows nothing about SQL                                           | Knows nothing about audio or LLMs |

The split keeps business rules (who can book what, when) out of the LLM process, so they can be tested, reused (e.g. by a future staff UI or SMS bot) and secured independently. Both are containerized for a future Kubernetes deployment. See [ADR 0002](adr/0002-phoner-integrator-split.md).

## The realtime pipeline (one turn)

1. **Capture** — the browser opens the mic with echo cancellation, noise suppression and AGC, downsamples to 16 kHz PCM16 in an AudioWorklet and sends 80 ms binary frames. The mic keeps streaming while the agent speaks (full duplex).
2. **STT** — phoner forwards frames to Deepgram Flux (`/v2/listen`, `flux-general-en`). Flux does turn detection itself and emits `TurnInfo` events: `StartOfTurn`, `Update`, `EndOfTurn` (and `EagerEndOfTurn` / `TurnResumed` when eager mode is on).
3. **Turn manager** — a state machine `listening → thinking → speaking → listening`. `EndOfTurn` commits the caller's text and starts an LLM turn with its own `AbortController`.
4. **LLM** — streams text and tool calls. The tool list offered on each request is filtered by `ToolPolicy` from the session state (see [tools.md](tools.md#gating)). Tool calls go to the integrator over HTTP; results (including errors like `SLOT_TAKEN`) are appended and the LLM continues.
5. **Sentence chunking** — streamed text is cut at sentence boundaries (`.`, `?`, `!`, plus a max-length fallback). Streaming tokens straight to TTS would make guardrails impossible; whole sentences give the guardrail something it can judge and TTS natural prosody.
6. **Guardrail** — each sentence is checked before it is spoken. P1: `NoopGuardrail`. P2 design in [guardrails.md](guardrails.md).
7. **TTS** — Cartesia over WebSocket, one context per sentence so each sentence's audio can be tracked; requests are capped at `TTS_MAX_CONCURRENCY` (default 1, Cartesia's plan limit) and audio is forwarded in sentence order.
8. **Playback** — the browser queues audio and reports `playback.mark` as each chunk finishes, so phoner knows what the caller actually heard.

**Barge-in**: a `StartOfTurn` while `thinking` or `speaking` aborts the LLM, cancels the TTS context, drops queued sentences, tells the browser to flush (`audio.clear`) and truncates the assistant message to what was played. Tool calls already in flight are allowed to finish (a booking may already be committed). Details in [realtime-protocol.md](realtime-protocol.md#barge-in).

## Latency budget

Target: caller stops speaking → first agent audio.

| Stage                      | Budget (p50)   | Notes                                                                         |
| -------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Flux end-of-turn decision  | 250–400 ms     | `eot_threshold=0.7`; eager EOT can cut this (off in P1)                       |
| LLM time to first sentence | 300–500 ms     | Flash Lite class model, short prompt, streaming                               |
| Guardrail                  | 0 ms (P1)      | P2 rules ≈ 1 ms; supervisor model 100–250 ms                                  |
| TTS time to first audio    | 90–150 ms      | Cartesia streaming                                                            |
| Network + playback buffer  | 100–150 ms     |                                                                               |
| **Total**                  | **~0.8–1.2 s** | Tool-call turns add one integrator round trip (~20–60 ms) + one more LLM pass |

Tool-call turns are the slow path. The prompt tells the agent to say a short filler ("Let me check that for you.") before calling availability so the caller isn't left in silence.

## Configuration

All services validate env with zod at startup and fail fast. Main switches:

| Var                                  | Default                                      | Service            |
| ------------------------------------ | -------------------------------------------- | ------------------ |
| `LLM_PROVIDER`                       | `google` (`scripted`)                        | phoner             |
| `LLM_MODEL`                          | Gemini Flash Lite 3.5 model ID               | phoner             |
| `STT_PROVIDER`                       | `deepgram-flux` (`scripted`)                 | phoner             |
| `TTS_PROVIDER`                       | `cartesia` (`silent`)                        | phoner             |
| `GUARDRAIL`                          | `noop`                                       | phoner             |
| `INTEGRATOR_URL`                     | `http://localhost:4001`                      | phoner             |
| `INTEGRATOR_TOKEN`                   | — (required, same value in both)             | phoner, integrator |
| `DATABASE_URL`, `DATABASE_POOL_MODE` | local Postgres (`docker compose`), `session` | integrator, db     |
| `SLOT_TOKEN_SECRET`                  | — (required)                                 | integrator         |
| `ADMIN_ENABLED`                      | `false` (`.env.example` sets `true`)         | integrator         |
| `CLINIC_TIMEZONE`                    | `America/Los_Angeles`                        | integrator         |

Full list in `.env.example`.
