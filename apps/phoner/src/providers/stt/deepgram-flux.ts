import WebSocket from "ws";
import { z } from "zod";
import type { SttConfig } from "../../config";
import { parseJson } from "../../json";
import type { SttHandlers, SttProvider, SttStream } from "./provider";

const TurnInfo = z.object({
  type: z.literal("TurnInfo"),
  event: z.enum(["StartOfTurn", "Update", "EagerEndOfTurn", "TurnResumed", "EndOfTurn"]),
  transcript: z.string().default(""),
});
const ErrorMessage = z.object({ type: z.literal("Error"), description: z.string().optional() });

export class DeepgramFluxSttProvider implements SttProvider {
  readonly name = "deepgram-flux";

  constructor(private readonly config: SttConfig) {}

  connect(handlers: SttHandlers): Promise<SttStream> {
    const params = new URLSearchParams({
      model: "flux-general-en",
      encoding: "linear16",
      sample_rate: "16000",
      eot_threshold: String(this.config.eotThreshold),
      eot_timeout_ms: String(this.config.eotTimeoutMs),
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v2/listen?${params}`, {
      headers: { Authorization: `Token ${this.config.apiKey}` },
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const json = parseJson(data.toString());
      const turn = TurnInfo.safeParse(json);
      if (turn.success) {
        if (turn.data.event === "StartOfTurn") handlers.onStartOfTurn();
        else if (turn.data.event === "Update") handlers.onUpdate(turn.data.transcript);
        else if (turn.data.event === "EndOfTurn") handlers.onEndOfTurn(turn.data.transcript);
        return;
      }
      const error = ErrorMessage.safeParse(json);
      if (error.success)
        handlers.onError(new Error(`Deepgram: ${error.data.description ?? "error"}`));
    });
    ws.on("error", (e) => handlers.onError(e));
    // Flux closes the stream after 60 s without a client ping (e.g. text-only calls with no audio).
    const keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.ping(), 15_000);
    ws.on("close", () => clearInterval(keepAlive));

    return new Promise((resolve, reject) => {
      ws.once("open", () =>
        resolve({
          send: (frame) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame);
          },
          close: async () => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
            ws.close();
          },
        }),
      );
      ws.once("unexpected-response", (_req, res) =>
        reject(new Error(`Deepgram rejected connection: ${res.statusCode}`)),
      );
    });
  }
}
