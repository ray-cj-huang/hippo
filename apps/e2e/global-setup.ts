import { createDb } from "@hippo/db";
import { resetDatabase, seedClinic } from "@hippo/db/testing";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "./playwright.config";

export default async function globalSetup() {
  const url = new URL(E2E_DATABASE_URL);
  const admin = postgres({
    host: url.hostname,
    port: Number(url.port),
    username: url.username,
    password: url.password,
    database: "postgres",
    max: 1,
    onnotice: () => {},
  });
  const name = url.pathname.slice(1);
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const { db, sql } = createDb({ url: E2E_DATABASE_URL, max: 1 });
  await migrate(db, {
    migrationsFolder: new URL("../../packages/db/drizzle", import.meta.url).pathname,
  });
  await resetDatabase(db);
  await seedClinic(db);
  await sql.end();
}
