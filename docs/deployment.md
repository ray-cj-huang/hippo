# Deployment

## Today (P1)

| Component         | Where                                                   | How                                                            |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/web`        | Vercel                                                  | Git integration: production on merge to `main`, preview per PR |
| `apps/phoner`     | Local (`pnpm dev` or `docker compose up`)               | Docker image pushed to GHCR on merge                           |
| `apps/integrator` | Local                                                   | Docker image pushed to GHCR on merge                           |
| Database          | Supabase Postgres (prod), Postgres 17 container locally | Migrations applied by GitHub Actions on merge                  |

Vercel serverless functions can't hold a call's WebSocket open for minutes, so phoner (and integrator alongside it) don't run there. The deployed console connects to `ws://localhost:4000` from the user's browser, which browsers allow from an https page because localhost is a secure context.

## Pipeline

```
PR opened ──► ci.yml: install → lint (Biome) → typecheck → test (Postgres service) → build → e2e (dev)
         └──► Vercel preview deploy ──► e2e-deployed.yml (deployment_status) → Playwright smoke on preview URL

merge to main ──► ci.yml (same checks)
              ├─► release.yml: migrate prod DB (environment: production) → build & push phoner/integrator images to GHCR
              └─► Vercel production deploy ──► e2e-deployed.yml on production URL
```

Practices:

- `main` is protected: PRs only, CI required, linear history.
- Migrations run **before** new code reaches prod and must be backward compatible with the running version (expand → migrate → contract).
- Vercel `ignoreCommand` uses `turbo-ignore` so web only rebuilds when it or its dependencies change.
- Secrets live in GitHub environments and Vercel env vars; nothing secret in the repo. `.env` is gitignored; `.env.example` documents every variable.
- Images are tagged with the commit SHA and `latest`. One root `Dockerfile` builds either backend (`--build-arg APP=integrator|phoner`); tsup bundles each app into a single file, so the runtime image is `node:24-alpine` plus `dist/`.
- `e2e-live.yml` runs the real-provider Playwright project on demand (`workflow_dispatch`), since it spends API credits.

### One-time setup

| Where                                | What                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub → Settings → Environments     | `production` environment with secret `PROD_DATABASE_URL` (Supabase session pooler) and required reviewers if you want a manual gate on migrations                                                      |
| GitHub → Secrets                     | `VERCEL_AUTOMATION_BYPASS_SECRET` (deployed e2e on protected previews), `GEMINI_API_KEY`, `CARTESIA_API_KEY` (live e2e)                                                                                |
| GitHub → Branch protection on `main` | require the `CI / check` status, require PRs, linear history                                                                                                                                           |
| Vercel project                       | Root directory `apps/web`, framework Next.js, env `ENABLE_EXPERIMENTAL_COREPACK=1` (so Vercel uses the pinned pnpm 12), `NEXT_PUBLIC_PHONER_URL` / `NEXT_PUBLIC_INTEGRATOR_URL` (default to localhost) |

## Supabase connection strings

Only the integrator (runtime) and drizzle-kit (migrations) connect to Postgres; the web app reads through the integrator, so Vercel never opens DB connections.

| Use                                   | Variable                           | Value                                                                                                         |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Local dev (`docker compose up -d db`) | `DATABASE_URL`                     | `postgresql://postgres:postgres@127.0.0.1:54322/postgres`                                                     |
| Prod integrator (long-lived server)   | `DATABASE_URL` in that environment | **Session pooler**: `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| Prod migrations (GitHub Actions)      | `PROD_DATABASE_URL` secret         | Session pooler (same URL)                                                                                     |

Why the session pooler:

- The **direct** host (`db.<ref>.supabase.co`) is IPv6-only unless you buy the IPv4 add-on; GitHub runners and many networks are IPv4-only.
- The **transaction** pooler (`:6543`) is for serverless fan-out; it doesn't support prepared statements and is unsuitable for migrations.

Notes:

- URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`).
- Locally, keep the prod URL in `PROD_DATABASE_URL`, never in `DATABASE_URL`, so seeds and tests can't hit production. `pnpm db:migrate:prod` is the only script that reads it.
- `packages/db` validates `DATABASE_URL` and `DATABASE_POOL_MODE` (`session` | `transaction`). In `transaction` mode the client sets `prepare: false`. Booking correctness doesn't depend on session state (see [concurrency.md](concurrency.md)), so switching is safe.
- The prod project is in `us-east-1`; host phoner/integrator in the same region.

## Future: Kubernetes (EKS)

```
              ┌─────────── EKS (us-east-1) ───────────┐
Twilio/SIP ──►│ ALB (WebSocket, idle timeout ≥ 1 h)   │
Browser   ──► │   └─► phoner  (Deployment, HPA on  │──► Deepgram / Gemini / Cartesia
              │        active calls)                  │
              │   └─► integrator (Deployment, HPA on  │──► Supabase (pooler)
              │        CPU, ClusterIP only)           │
              └───────────────────────────────────────┘
```

- phoner needs sticky, long-lived connections: ALB with a long idle timeout, `preStop` hook + `terminationGracePeriodSeconds` long enough to drain active calls on deploy.
- Scale phoner on a custom metric (active calls per pod), not CPU.
- integrator is internal only (ClusterIP); the console's DB panel would go through an authenticated API.
- With many integrator replicas, consider the transaction pooler (`DATABASE_POOL_MODE=transaction`).
- Deploy via Helm or Kustomize from GitHub Actions using the GHCR images already built today.

## Alternatives to EKS for the voice backend

All support long-lived WebSockets and Docker images:

| Platform                     | Notes                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- |
| Fly.io                       | Firecracker microVMs in chosen regions; simple, cheap, good for low-latency voice |
| Railway / Render             | Easiest Docker hosting with GitHub auto-deploy                                    |
| Google Cloud Run             | WebSockets up to 60 min per request; scales to zero                               |
| AWS ECS Fargate / App Runner | AWS-native without running Kubernetes                                             |
