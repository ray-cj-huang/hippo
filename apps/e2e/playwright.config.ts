import { defineConfig, devices } from "@playwright/test";

const deployed = process.env.BASE_URL;
const live = process.argv.includes("--project=live");

export const E2E_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/hippo_e2e";
const ports = { web: 3100, phoner: 4100, integrator: 4101 };
const web = `http://localhost:${ports.web}`;

const providers = live
  ? { LLM_PROVIDER: "google", STT_PROVIDER: "none", TTS_PROVIDER: "cartesia" }
  : { LLM_PROVIDER: "scripted", STT_PROVIDER: "none", TTS_PROVIDER: "silent" };

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: deployed ? undefined : "./global-setup.ts",
  use: {
    baseURL: deployed ?? web,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {},
  },
  projects: [
    { name: "dev", testIgnore: /(deployed|live)\.spec\.ts/, use: devices["Desktop Chrome"] },
    { name: "live", testMatch: /live\.spec\.ts/, timeout: 120_000, use: devices["Desktop Chrome"] },
    { name: "deployed", testMatch: /deployed\.spec\.ts/, use: devices["Desktop Chrome"] },
  ],
  webServer: deployed
    ? undefined
    : [
        {
          command: "pnpm --filter @hippo/integrator exec tsx src/index.ts",
          url: `http://localhost:${ports.integrator}/health`,
          reuseExistingServer: false,
          env: {
            DATABASE_URL: E2E_DATABASE_URL,
            INTEGRATOR_PORT: String(ports.integrator),
            SLOT_TOKEN_SECRET: "e2e-slot-token-secret-0123456789",
            CORS_ORIGINS: web,
          },
        },
        {
          command: `pnpm --filter @hippo/phoner exec tsx ${live ? "--env-file=../../.env " : ""}src/index.ts`,
          url: `http://localhost:${ports.phoner}/health`,
          reuseExistingServer: false,
          env: {
            ...providers,
            PHONER_PORT: String(ports.phoner),
            INTEGRATOR_URL: `http://localhost:${ports.integrator}`,
            ALLOWED_ORIGINS: web,
          },
        },
        {
          command: `pnpm --filter @hippo/web exec sh -c "next build && next start --port ${ports.web}"`,
          url: web,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            NEXT_DIST_DIR: ".next-e2e",
            NEXT_PUBLIC_PHONER_URL: `http://localhost:${ports.phoner}`,
            NEXT_PUBLIC_INTEGRATOR_URL: `http://localhost:${ports.integrator}`,
          },
        },
      ],
});
