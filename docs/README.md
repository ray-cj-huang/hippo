# Hippo docs

Hippo is a voice AI agent that schedules 30-minute doctor appointments for a single multi-specialty medical center. A caller talks to the agent; the agent verifies who they are, figures out which doctor or specialty they need, checks availability and books, cancels, reschedules or lists appointments.

## Start here

| Doc                                              | What it covers                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| [requirements.md](requirements.md)               | Functional and non-functional requirements, scope for P1           |
| [assumptions.md](assumptions.md)                 | Assumptions we made and what would change them                     |
| [architecture.md](architecture.md)               | System diagram, services, the realtime pipeline, latency budget    |
| [conversation-design.md](conversation-design.md) | Call flows, patient verification, triage rules, system prompt      |
| [tools.md](tools.md)                             | LLM tool contracts, gating rules, error codes                      |
| [concurrency.md](concurrency.md)                 | How simultaneous callers racing for one slot are handled           |
| [data-model.md](data-model.md)                   | Database schema and invariants                                     |
| [realtime-protocol.md](realtime-protocol.md)     | Browser ⇄ phoner WebSocket protocol, turn-taking, barge-in         |
| [providers.md](providers.md)                     | Factory pattern for LLM / STT / TTS / guardrail providers          |
| [guardrails.md](guardrails.md)                   | Output guardrail design (P2), comparison to Hippocratic AI Polaris |
| [testing.md](testing.md)                         | Unit, integration and Playwright end-to-end strategy               |
| [development.md](development.md)                 | Local setup and day-to-day commands                                |
| [deployment.md](deployment.md)                   | Vercel, Supabase, CI/CD, database URLs, future EKS                 |
| [adr/](adr/)                                     | Architecture decision records                                      |

## Glossary

- **phoner** — the realtime voice service. Owns a call: STT → LLM → guardrail → TTS, turn-taking and tool gating.
- **integrator** — the tool-execution service. Owns business rules and the database (availability, patients, appointments).
- **slot** — a 30-minute window for one doctor. Slots are computed, not stored.
- **slotToken** — a short-lived signed token for one slot, issued only by `get_availability`. Required to book or reschedule.
- **turn** — one caller utterance and the agent's response to it.
- **barge-in** — the caller speaking while the agent is thinking or speaking; the agent stops and listens.
