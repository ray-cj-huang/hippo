import { loadConfig } from "./config";
import { createPhonerServer } from "./server";

const config = loadConfig();
const server = createPhonerServer(config);

server.http.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      msg: "phoner listening",
      port: config.port,
      llm: `${config.llm.provider}/${config.llm.model}`,
      stt: config.stt.provider,
      tts: config.tts.provider,
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
