import WebSocket from "ws";
import { z } from "zod";
import type { TtsConfig } from "../../config";
import { parseJson } from "../../json";
import type { SpeechHandlers, TtsProvider } from "./provider";

const CARTESIA_VERSION = "2026-08-14";

const Message = z.object({
  type: z.string(),
  context_id: z.string().optional(),
  data: z.string().optional(),
  message: z.string().optional(),
  title: z.string().optional(),
});

/** One Cartesia context per sentence, so audio maps back to the sentence the caller heard. */
export class CartesiaTtsProvider implements TtsProvider {
  readonly name = "cartesia";
  readonly sampleRate = 24000;
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, SpeechHandlers>();

  constructor(private readonly config: TtsConfig) {}

  open(): Promise<void> {
    const ws = new WebSocket(
      `wss://api.cartesia.ai/tts/websocket?cartesia_version=${CARTESIA_VERSION}`,
      {
        headers: { "X-API-Key": this.config.apiKey, "Cartesia-Version": CARTESIA_VERSION },
      },
    );
    this.ws = ws;

    ws.on("message", (raw) => {
      const msg = Message.safeParse(parseJson(raw.toString()));
      if (!msg.success || !msg.data.context_id) return;
      const handlers = this.pending.get(msg.data.context_id);
      if (!handlers) return;
      if (msg.data.type === "chunk" && msg.data.data)
        handlers.onAudio(Buffer.from(msg.data.data, "base64"));
      else if (msg.data.type === "done") {
        this.pending.delete(msg.data.context_id);
        handlers.onDone();
      } else if (msg.data.type === "error") {
        this.pending.delete(msg.data.context_id);
        handlers.onError(
          new Error(`Cartesia: ${msg.data.title ?? ""} ${msg.data.message ?? ""}`.trim()),
        );
      }
    });
    ws.on("close", () => {
      for (const handlers of this.pending.values())
        handlers.onError(new Error("Cartesia connection closed"));
      this.pending.clear();
    });

    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
  }

  speak(id: string, text: string, handlers: SpeechHandlers) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      handlers.onError(new Error("Cartesia is not connected"));
      return;
    }
    this.pending.set(id, handlers);
    this.ws.send(
      JSON.stringify({
        model_id: this.config.model,
        transcript: text,
        voice: { mode: "id", id: this.config.voiceId },
        language: "en",
        context_id: id,
        continue: false,
        output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: this.sampleRate },
      }),
    );
  }

  cancel(id: string) {
    if (!this.pending.delete(id)) return;
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ context_id: id, cancel: true }));
  }

  close() {
    this.pending.clear();
    this.ws?.close();
  }
}
