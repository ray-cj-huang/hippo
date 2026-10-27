---

name: prompt-change
description: Change the Hippo voice agent's system prompt, triage rules, identity verification or booking confirmation behavior. Use for any edit to apps/phoner/src/prompt/system-prompt.ts or when the agent says or does the wrong thing on a call.
---

# Change the agent's prompt

The prompt is safety-relevant: it governs emergencies, identity and what the agent claims happened.

1. Reproduce first: run `pnpm dev`, open http://localhost:3000, use **Text only**, and note the exact turns and the tool calls panel.
2. Prefer enforcing behavior in code over the prompt when it's a rule, not a style: tool gating (`apps/phoner/src/tools/policy.ts`) and integrator checks can't be talked around; the prompt can.
3. Edit `apps/phoner/src/prompt/system-prompt.ts`. Keep the XML sections; state rules positively and concretely ("repeat the date of birth back and wait for a yes"), one behavior per sentence. Dynamic data comes from `GET /clinic`; don't hardcode doctors or dates.
4. Mirror the change in `docs/conversation-design.md` (triage table, sample calls, prompt draft).
5. Re-run the reproduction with the real model, and run `pnpm e2e:live` (needs API keys) for a booking flow. For triage or emergency changes, also try at least one red-flag phrase and one vague complaint.
6. Never add instructions that let the agent diagnose, recommend treatment, or confirm an action without a successful tool result.
