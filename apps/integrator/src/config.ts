import { z } from "zod";

const Env = z
  .object({
    INTEGRATOR_PORT: z.coerce.number().int().default(4001),
    SLOT_TOKEN_SECRET: z.string().min(16, "SLOT_TOKEN_SECRET must be at least 16 characters"),
    INTEGRATOR_TOKEN: z.string().min(32, "INTEGRATOR_TOKEN must be at least 32 characters"),
    ADMIN_ENABLED: z.stringbool().default(false),
    SLOT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 60),
    CLINIC_NAME: z.string().default("Hippo Medical Center"),
    CLINIC_TIMEZONE: z.string().default("America/Los_Angeles"),
    BOOKING_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((v) => v.split(",").map((s) => s.trim())),
  })
  .transform((e) => ({
    port: e.INTEGRATOR_PORT,
    slotTokenSecret: e.SLOT_TOKEN_SECRET,
    slotTokenTtlSeconds: e.SLOT_TOKEN_TTL_SECONDS,
    serviceToken: e.INTEGRATOR_TOKEN,
    adminEnabled: e.ADMIN_ENABLED,
    clinicName: e.CLINIC_NAME,
    timezone: e.CLINIC_TIMEZONE,
    bookingWindowDays: e.BOOKING_WINDOW_DAYS,
    corsOrigins: e.CORS_ORIGINS,
  }));

export type Config = z.output<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
