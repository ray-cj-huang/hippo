import { fileURLToPath } from "node:url";
import { z } from "zod";

const Env = z
  .object({
    PHONER_PORT: z.coerce.number().int().default(4000),
    INTEGRATOR_URL: z.url().default("http://localhost:4001"),
    INTEGRATOR_TOKEN: z.string().min(32, "INTEGRATOR_TOKEN must be at least 32 characters"),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((v) => v.split(",").map((s) => s.trim())),

    LLM_PROVIDER: z.enum(["google", "scripted"]).default("google"),
    LLM_MODEL: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    SCENARIOS_DIR: z
      .string()
      .default(fileURLToPath(new URL("../../e2e/scenarios", import.meta.url))),

    STT_PROVIDER: z.enum(["deepgram-flux", "none"]).default("deepgram-flux"),
    DEEPGRAM_API_KEY: z.string().optional(),
    FLUX_EOT_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.7),
    FLUX_EOT_TIMEOUT_MS: z.coerce.number().int().default(5000),

    TTS_PROVIDER: z.enum(["cartesia", "silent"]).default("cartesia"),
    CARTESIA_API_KEY: z.string().optional(),
    CARTESIA_MODEL: z.string().default("sonic-3.6"),
    CARTESIA_VOICE_ID: z.string().default("a0e99841-438c-4a64-b679-ae501e7d6091"),
    TTS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),

    GUARDRAIL: z.enum(["noop"]).default("noop"),
  })
  .superRefine((e, ctx) => {
    const need = (when: boolean, key: keyof typeof e) => {
      if (when && !e[key])
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required` });
    };
    need(e.LLM_PROVIDER === "google", "GEMINI_API_KEY");
    need(e.STT_PROVIDER === "deepgram-flux", "DEEPGRAM_API_KEY");
    need(e.TTS_PROVIDER === "cartesia", "CARTESIA_API_KEY");
  });

const defaultModels = {
  google: "gemini-3.5-flash-lite",
  scripted: "scripted",
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  return {
    port: e.PHONER_PORT,
    integratorUrl: e.INTEGRATOR_URL,
    integratorToken: e.INTEGRATOR_TOKEN,
    allowedOrigins: e.ALLOWED_ORIGINS,
    llm: {
      provider: e.LLM_PROVIDER,
      model: e.LLM_MODEL ?? defaultModels[e.LLM_PROVIDER],
      geminiApiKey: e.GEMINI_API_KEY ?? "",
      scenariosDir: e.SCENARIOS_DIR,
    },
    stt: {
      provider: e.STT_PROVIDER,
      apiKey: e.DEEPGRAM_API_KEY ?? "",
      eotThreshold: e.FLUX_EOT_THRESHOLD,
      eotTimeoutMs: e.FLUX_EOT_TIMEOUT_MS,
    },
    tts: {
      provider: e.TTS_PROVIDER,
      apiKey: e.CARTESIA_API_KEY ?? "",
      model: e.CARTESIA_MODEL,
      voiceId: e.CARTESIA_VOICE_ID,
      maxConcurrency: e.TTS_MAX_CONCURRENCY,
    },
    guardrail: { provider: e.GUARDRAIL },
  };
}

export type Config = ReturnType<typeof loadConfig>;
export type LlmConfig = Config["llm"];
export type SttConfig = Config["stt"];
export type TtsConfig = Config["tts"];
export type GuardrailConfig = Config["guardrail"];
