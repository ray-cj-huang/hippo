import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, LOCAL_DATABASE_URL } from "./client";

const prod = process.argv.includes("--prod");
const url = prod ? process.env.PROD_DATABASE_URL : (process.env.DATABASE_URL ?? LOCAL_DATABASE_URL);

if (!url) {
  console.error(prod ? "PROD_DATABASE_URL is not set." : "DATABASE_URL is not set.");
  process.exit(1);
}

const host = new URL(url).hostname;
const isLocalHost = ["127.0.0.1", "localhost", "postgres"].includes(host);
if (!prod && !isLocalHost && !process.env.CI) {
  console.error(
    `Refusing to migrate non-local database at ${host}. Use \`pnpm db:migrate:prod\` (reads PROD_DATABASE_URL) for production.`,
  );
  process.exit(1);
}

const { db, sql } = createDb({ url, max: 1, poolMode: "session" });
console.log(`Applying migrations to ${host}${prod ? " (production)" : ""}…`);
await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await sql.end();
console.log("Migrations applied.");
