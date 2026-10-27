import type { TtsProvider } from "../providers/tts/provider";
import type { CallTransport } from "../transport/transport";

type Chunk = {
  id: string;
  text: string;
  buffered: Buffer[];
  requested: boolean;
  done: boolean;
  ended: boolean;
  played: boolean;
};

export type SpeechEvents = { onFirstAudio(): void; onIdle(): void; onError(error: Error): void };

// One TTS request per sentence so we know exactly which sentences the caller heard.
export class SpeechQueue {
  private queue: Chunk[] = [];
  private readonly byId = new Map<string, Chunk>();
  private audioStarted = false;

  constructor(
    private readonly tts: TtsProvider,
    private readonly transport: CallTransport,
    private readonly events: SpeechEvents,
    private readonly maxConcurrent = 1,
  ) {}

  get idle() {
    return this.queue.length === 0;
  }

  beginTurn() {
    this.audioStarted = false;
  }

  enqueue(id: string, text: string) {
    const chunk: Chunk = {
      id,
      text,
      buffered: [],
      requested: false,
      done: false,
      ended: false,
      played: false,
    };
    this.queue.push(chunk);
    this.byId.set(id, chunk);
    this.requestNext();
  }

  private requestNext() {
    const inFlight = this.queue.filter((c) => c.requested && !c.done).length;
    const next = this.queue.find((c) => !c.requested);
    if (!next || inFlight >= this.maxConcurrent) return;
    next.requested = true;
    this.synthesize(next);
    this.requestNext();
  }

  private synthesize(chunk: Chunk) {
    this.tts.speak(chunk.id, chunk.text, {
      onAudio: (pcm) => {
        if (this.head() === chunk) this.forward(chunk, pcm);
        else chunk.buffered.push(pcm);
      },
      onDone: () => this.finish(chunk),
      onError: (error) => {
        this.events.onError(error);
        this.finish(chunk);
      },
    });
  }

  markPlayed(id: string) {
    const chunk = this.byId.get(id);
    if (!chunk) return;
    chunk.played = true;
    this.queue = this.queue.filter((c) => !(c.played && c.ended));
    if (this.idle) this.events.onIdle();
  }

  heard(ids: string[]): string {
    return ids
      .map((id) => this.byId.get(id))
      .filter((c) => c?.played)
      .map((c) => c?.text)
      .join(" ");
  }

  clear() {
    for (const chunk of this.queue) if (chunk.requested && !chunk.done) this.tts.cancel(chunk.id);
    this.queue = [];
  }

  private head() {
    return this.queue.find((c) => !c.ended);
  }

  private finish(chunk: Chunk) {
    if (!this.queue.includes(chunk)) return;
    chunk.done = true;
    this.requestNext();
    for (let head = this.head(); head; head = this.head()) {
      for (const pcm of head.buffered) this.forward(head, pcm);
      head.buffered = [];
      if (!head.done) return;
      head.ended = true;
      this.transport.send({ type: "audio.end", chunkId: head.id });
    }
  }

  private forward(chunk: Chunk, pcm: Buffer) {
    if (!this.audioStarted) {
      this.audioStarted = true;
      this.events.onFirstAudio();
    }
    this.transport.sendAudio(chunk.id, pcm);
  }
}
