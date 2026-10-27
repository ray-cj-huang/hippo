# 0009 — The integrator trusts the call, not the request

- Status: accepted
- Date: 2026-10-27

## Context

The integrator had no authentication and took `patientId` from the request body. phoner injected the verified patient's ID, but anything that could reach the integrator could skip `verify_patient` and book, cancel or list for any patient, and `GET /admin/snapshot` returned every patient's name and DOB. In P1 the integrator only runs locally, but docker compose published it on all interfaces, any web page in the user's browser could send it blind POSTs, and the planned cluster deployment would widen the exposure.

## Decision

- **Patient from the call.** A successful `verify_patient` already sets `calls.patient_id` for the `X-Call-Id` it came with. Patient-scoped routes (`/availability`'s age check, `GET /appointments`, book, cancel, reschedule) read the patient from that row and return `PATIENT_NOT_IDENTIFIED` when the call has none. Request bodies no longer carry `patientId`.
- **Service token.** Every route except `/health` and `/admin/*` requires `Authorization: Bearer $INTEGRATOR_TOKEN`, compared in constant time; a miss returns `UNAUTHORIZED` (401). phoner and integrator share the value through env.
- **Admin off by default.** `/admin/snapshot` is registered only with `ADMIN_ENABLED=true`; `.env.example` and e2e turn it on. A staff console with real sign-in is out of scope.
- docker compose publishes phoner and integrator on `127.0.0.1` only.

## Alternatives

- Token only, keep `patientId` in the body: one leaked token or a phoner bug acts for any patient.
- Signed patient token issued by `verify_patient`, like `slotToken`: no DB read, but another secret and expiry to manage while the call row already exists.
- mTLS or network policy only: fits the cluster later, does nothing for a local browser.

## Implementation

- `packages/contracts/src/api.ts` — request schemas without `patientId`; `results.ts` — `UNAUTHORIZED`.
- `apps/integrator/src/auth.ts` — `requireServiceToken`; `app.ts` — public routes first, then the token middleware, then the rest.
- `apps/integrator/src/integration-calls.ts` — resolves the call's verified patient and exposes it as `patientId`.
- `apps/phoner/src/tools/integrator.ts`, `executor.ts` — send the token; stop sending `patientId`.

## Verification

- [x] `apps/integrator/test/integration/auth.test.ts`: 401 without or with a wrong token, public `/health`, admin absent unless enabled, `PATIENT_NOT_IDENTIFIED` on an unverified call, a body `patientId` is ignored, `verify_patient` binds the call.

## Consequences

- One extra `calls` read per recorded request that carries `X-Call-Id`.
- Re-verifying as someone else on the same call switches the call's patient, matching phoner's session state.
- Rotating `INTEGRATOR_TOKEN` needs both services restarted together.
