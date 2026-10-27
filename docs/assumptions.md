# Assumptions

Each assumption lists what would change if it turned out wrong.

| #   | Assumption                                                                                                                           | If wrong                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| A1  | One medical center, one timezone (`America/Los_Angeles`, configurable via `CLINIC_TIMEZONE`).                                        | Add `locations` table; slots and prompt become location-aware.                                 |
| A2  | Every appointment is exactly 30 minutes and starts at :00 or :30.                                                                    | Add `duration_minutes` per appointment type; availability math generalizes to intervals.       |
| A3  | Doctors work fixed weekly hours (`doctor_schedules`), no breaks, no holidays in P1.                                                  | Add `schedule_exceptions` (time off, holidays); availability subtracts them.                   |
| A4  | Name + DOB uniquely identifies a patient. Name alone is not enough (two John Smiths exist).                                          | Add a third identifier (phone, MRN) to `verify_patient`.                                       |
| A5  | Callers can self-refer to specialists (PPO-style). Insurance and HMO referrals are not checked.                                      | Add insurance capture and a referral check before booking specialists.                         |
| A6  | Callers book for themselves. A parent booking for a child gives the child's name and DOB.                                            | Add caller-vs-patient relationship and consent capture.                                        |
| A7  | Bookable window is today + 1 day through 30 days out (`BOOKING_WINDOW_DAYS`). No same-day booking.                                   | Same-day needs a cutoff (e.g. ≥ 2 h ahead) and possibly urgent-slot holds.                     |
| A8  | English only.                                                                                                                        | Deepgram `flux-general-multi`, multilingual TTS voice, localized prompt.                       |
| A9  | The browser mic is an acceptable stand-in for a phone line in P1. 16 kHz audio (phone is 8 kHz μ-law).                               | Twilio Media Streams transport with `mulaw`/8 kHz to Flux.                                     |
| A10 | The console is internal/demo; no auth. It shows all patients in the DB panel.                                                        | Add auth and remove the admin read endpoints from public reach.                                |
| A11 | A slot is not held between availability and booking. The `slotToken` proves availability was checked; the database decides who wins. | Add short-lived holds if callers frequently lose races (see [concurrency.md](concurrency.md)). |
| A12 | Emergency detection is prompt-based in P1.                                                                                           | Guardrail/supervisor model in P2 ([guardrails.md](guardrails.md)).                             |
| A13 | phoner and integrator run locally in P1; only the web console is deployed (Vercel).                                                  | Hosted on Kubernetes (EKS) — see [deployment.md](deployment.md).                               |
