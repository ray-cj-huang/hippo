# 0002 — Separate phoner (voice) and integrator (tools) services

- Status: accepted
- Date: 2026-10-27

## Context

The voice loop is stateful, latency-critical and talks to AI vendors. Scheduling rules are stateless, correctness-critical and talk to the database. A single process would mix both concerns and let LLM code reach the database directly.

## Decision

- `apps/phoner` owns calls: transport, STT, LLM, guardrail, TTS, turn-taking, tool gating.
- `apps/integrator` owns business rules and data, exposed as a zod-validated HTTP API (Hono).
- The only path from the LLM to data is phoner → integrator HTTP.

## Consequences

- One extra network hop per tool call (~5–20 ms in-cluster; acceptable vs. LLM latency).
- Business rules are testable without audio or LLMs and reusable by future clients (staff UI, SMS).
- Independent scaling and deployment on Kubernetes later.
