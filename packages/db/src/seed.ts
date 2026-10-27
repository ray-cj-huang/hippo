import { createDb, LOCAL_DATABASE_URL } from "./client";
import { resetDatabase, seedClinic } from "./testing";

const url = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
const host = new URL(url).hostname;

if (host !== "127.0.0.1" && host !== "localhost" && !process.argv.includes("--force")) {
  console.error(`Refusing to reset non-local database at ${host}. Pass --force if you mean it.`);
  process.exit(1);
}

const { db, sql } = createDb({ url, max: 1 });
await resetDatabase(db);
await seedClinic(db);
await sql.end();
console.log("Seeded clinic and demo patients.");
