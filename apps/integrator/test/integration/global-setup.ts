import { createDb } from "@hippo/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "./helpers";

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = postgres({ ...parse(url), database: "postgres", max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const { db, sql } = createDb({ url: TEST_DATABASE_URL, max: 1 });
  await migrate(db, {
    migrationsFolder: new URL("../../../../packages/db/drizzle", import.meta.url).pathname,
  });
  await sql.end();
}

function parse(url: URL) {
  return {
    host: url.hostname,
    port: Number(url.port),
    username: url.username,
    password: url.password,
  };
}
