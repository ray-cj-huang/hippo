import { ClientMessage, type ServerMessage } from "@hippo/contracts";
import type WebSocket from "ws";
import { parseJson } from "../json";

export type TransportHandlers = {
  onAudio(frame: Buffer): void;
  onMessage(message: ClientMessage): void;
  onClose(): void;
};

export interface CallTransport {
  send(message: ServerMessage): void;
  sendAudio(chunkId: string, pcm: Buffer): void;
  listen(handlers: TransportHandlers): void;
  close(): void;
}

export class BrowserWsTransport implements CallTransport {
  constructor(private readonly ws: WebSocket) {}

  send(message: ServerMessage) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendAudio(chunkId: string, pcm: Buffer) {
    this.send({ type: "audio.chunk", chunkId, bytes: pcm.length });
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(pcm, { binary: true });
  }

  listen(handlers: TransportHandlers) {
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        handlers.onAudio(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        return;
      }
      const parsed = ClientMessage.safeParse(parseJson(data.toString()));
      if (parsed.success) handlers.onMessage(parsed.data);
    });
    this.ws.on("close", () => handlers.onClose());
  }

  close() {
    this.ws.close();
  }
}
