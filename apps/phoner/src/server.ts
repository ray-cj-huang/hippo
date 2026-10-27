import { createServer, type IncomingMessage } from "node:http";
import { ClientMessage } from "@hippo/contracts";
import { WebSocketServer } from "ws";
import type { Config } from "./config";
import { parseJson } from "./json";
import { CallSession } from "./pipeline/call-session";
import { createGuardrail } from "./providers/guardrail/guardrail";
import { createLlmProvider } from "./providers/llm/create";
import { createSttProvider } from "./providers/stt/create";
import { createTtsProvider } from "./providers/tts/create";
import { HttpIntegrator } from "./tools/integrator";
import { BrowserWsTransport } from "./transport/transport";

export function createPhonerServer(config: Config) {
  const integrator = new HttpIntegrator(config.integratorUrl, config.integratorToken);
  const sessions = new Set<CallSession>();

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ ok: true, activeCalls: sessions.size, llm: config.llm.provider }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  http.on("upgrade", (req, socket, head) => {
    if (
      new URL(req.url ?? "/", "http://localhost").pathname !== "/call" ||
      !originAllowed(req, config)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.once("message", (data, isBinary) => {
        const first = isBinary ? null : ClientMessage.safeParse(parseJson(data.toString()));
        if (!first?.success || first.data.type !== "session.start") {
          ws.close(1008, "expected session.start");
          return;
        }
        const session = new CallSession({
          transport: new BrowserWsTransport(ws),
          llm: createLlmProvider(config.llm, first.data.scenario),
          stt: createSttProvider(config.stt),
          tts: createTtsProvider(config.tts),
          guardrail: createGuardrail(config.guardrail),
          integrator,
          ttsConcurrency: config.tts.maxConcurrency,
        });
        sessions.add(session);
        ws.on("close", () => sessions.delete(session));
        void session.start();
      });
    });
  });

  return {
    http,
    async close() {
      await Promise.all([...sessions].map((s) => s.end("shutdown")));
      wss.close();
      http.close();
    },
  };
}

function originAllowed(req: IncomingMessage, config: Config) {
  const origin = req.headers.origin;
  return !origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
}
