import { createDb } from "@hippo/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { purgeIdempotencyKeys } from "./idempotency";

const config = loadConfig();
const { db, sql } = createDb();
const app = createApp(createContext(db, config));

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(JSON.stringify({ level: "info", msg: "integrator listening", port }));
});

const purge = setInterval(() => void purgeIdempotencyKeys(db, new Date()), 60 * 60 * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(purge);
    server.close(() => void sql.end().then(() => process.exit(0)));
  });
}
