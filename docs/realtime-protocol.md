# Realtime protocol

One WebSocket per call between the browser console and phoner (`ws://localhost:4000/call`). Binary frames carry audio; text frames carry JSON messages validated by `@hippo/contracts` (`ClientMessage`, `ServerMessage`).

## Audio formats

| Direction        | Format                                                   | Frame size                                                    |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Browser → phoner | PCM16 little-endian, mono, 16 kHz                        | 80 ms = 1280 samples = 2560 bytes (Deepgram's recommendation) |
| phoner → browser | PCM16 little-endian, mono, 24 kHz (Cartesia `pcm_s16le`) | as received from Cartesia                                     |

The browser captures with `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` and downsamples in an AudioWorklet. Echo cancellation matters: the mic stays open while the agent speaks, and without AEC the agent would transcribe itself.

## Messages

### Client → server

| type            | payload                            | when                                                                        |
| --------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `session.start` | `{ sampleRate: 16000, scenario? }` | right after connect                                                         |
| `user.text`     | `{ text }`                         | typed caller turn (console text mode, e2e); handled like a Flux `EndOfTurn` |
| _(binary)_      | PCM16 frame                        | continuously                                                                |
| `playback.mark` | `{ chunkId }`                      | an agent audio chunk finished playing                                       |
| `session.end`   | `{}`                               | caller hangs up                                                             |

### Server → client

| type            | payload                                                | when                                                                                                |
| --------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `session.ready` | `{ callId }`                                           | STT and TTS connected                                                                               |
| `state`         | `{ state: "listening" \| "thinking" \| "speaking" }`   | turn state changes                                                                                  |
| `stt.partial`   | `{ text }`                                             | Flux `Update`                                                                                       |
| `stt.final`     | `{ text }`                                             | Flux `EndOfTurn`                                                                                    |
| `llm.delta`     | `{ turnId, text }`                                     | streamed LLM text (console only, not spoken yet)                                                    |
| `agent.chunk`   | `{ turnId, chunkId, text }`                            | a sentence approved by the guardrail and sent to TTS                                                |
| `audio.chunk`   | `{ chunkId }` then a binary frame                      | TTS audio; the JSON header precedes its binary frame                                                |
| `audio.end`     | `{ chunkId }`                                          | all audio for that sentence has been sent; the browser acks with `playback.mark` once it has played |
| `audio.clear`   | `{ turnId }`                                           | barge-in: drop everything queued                                                                    |
| `tool.call`     | `{ toolCallId, name, args }`                           | before calling integrator                                                                           |
| `tool.result`   | `{ toolCallId, name, ok, result \| error, latencyMs }` | after                                                                                               |
| `error`         | `{ code, message }`                                    | provider or internal failure                                                                        |
| `session.ended` | `{ reason }`                                           | call over                                                                                           |

## Turn-taking

phoner keeps a `CallSession` state machine driven by Flux `TurnInfo` events:

```
           EndOfTurn                 first sentence to TTS
listening ───────────► thinking ─────────────────────────► speaking
    ▲                     │  StartOfTurn (barge-in)            │
    │◄────────────────────┘                                    │
    │◄──────────────── StartOfTurn (barge-in) ─────────────────┤
    └────────────────────── last audio played ─────────────────┘
```

Flux connection: `wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.7&eot_timeout_ms=5000`.

- `Update` → `stt.partial` to the console.
- `EndOfTurn` → `stt.final`, append the user message, start an LLM turn with a fresh `AbortController`.
- `StartOfTurn` while `listening` → nothing special (the caller started talking).

## Barge-in

`StartOfTurn` while `thinking` or `speaking`:

1. Abort the LLM stream (`AbortController.abort()`).
2. Cancel the Cartesia context and drop sentences not yet sent.
3. Send `audio.clear` — the browser flushes its playback queue (silence within one buffer, ~50 ms).
4. Let in-flight tool calls finish. A booking may already be committed; its result is appended to history so the next turn can mention it. No further LLM round runs for the interrupted turn.
5. Truncate every assistant message the turn spoke to the chunks the browser acknowledged with `playback.mark`, so the LLM knows what the caller actually heard (it must not believe it said "you're booked" if that sentence was cut). Messages with tool calls keep their provider-native content (thinking blocks, thought signatures); only their text is replaced.
6. Send one `agent.interrupted` with the turn's heard text, and log `barge_in`.
7. State → `listening`. The interrupting speech becomes the next user turn.

The model often finishes generating, and tools often finish running, long before the audio finishes playing. Truncation therefore covers every spoken message of the turn, including text spoken before a tool call, whether or not generation was still running.

The greeting is turn `t0` and is interrupted the same way. The session is `thinking` from the moment the greeting is queued, so the caller can interrupt it before its first audio arrives.

A `StartOfTurn` followed by an `EndOfTurn` while the barge-in is still waiting for a tool share one barge-in.

Frames that aren't valid JSON or don't match `ClientMessage` are dropped; an invalid first frame closes the socket with 1008. Frames are capped at 64 KB.

Known P1 limitation: short backchannels ("uh-huh") also trigger barge-in. Future: pause audio on `StartOfTurn`, but only cancel the turn once the `Update` transcript has ≥ 2 words; resume otherwise.

## Eager end-of-turn (designed, off in P1)

Enabled with `FLUX_EAGER_EOT_THRESHOLD` (e.g. 0.5). Deepgram says it can save hundreds of ms but raises LLM calls 50–70%.

- `EagerEndOfTurn` → start a **speculative** LLM turn. Its output is buffered (not sent to the guardrail/TTS) and it pauses at its first tool call.
- `TurnResumed` → discard the speculative turn.
- `EndOfTurn` → if the transcript is unchanged, release the buffered output and unpause tools; otherwise discard and start a normal turn.

Side-effecting tools never run speculatively.

## Future: phone transport

`CallTransport` abstracts the browser socket. A `TwilioMediaStreamTransport` will translate Twilio Media Streams (8 kHz μ-law, base64 JSON frames, `clear` events) to the same internal interface; Flux accepts `encoding=mulaw&sample_rate=8000`, and Cartesia can output `pcm_mulaw` at 8 kHz.
