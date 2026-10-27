import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "./schema";

export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const DbEnv = z.object({
  DATABASE_URL: z.url().default(LOCAL_DATABASE_URL),
  DATABASE_POOL_MODE: z.enum(["session", "transaction"]).default("session"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
});

export type DbOptions = { url?: string; poolMode?: "session" | "transaction"; max?: number };

function isLocal(url: string) {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost";
}

export function createDb(options: DbOptions = {}) {
  const env = DbEnv.parse(process.env);
  const url = options.url ?? env.DATABASE_URL;
  const poolMode = options.poolMode ?? env.DATABASE_POOL_MODE;
  const sql = postgres(url, {
    max: options.max ?? env.DATABASE_POOL_MAX,
    // Supabase's transaction pooler doesn't support prepared statements.
    prepare: poolMode === "session",
    ssl: new URL(url).searchParams.has("sslmode") ? undefined : isLocal(url) ? false : "require",
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema, casing: "snake_case" }), sql };
}

export type Db = ReturnType<typeof createDb>["db"];
