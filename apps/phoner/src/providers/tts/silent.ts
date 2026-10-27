import type { SpeechHandlers, TtsProvider } from "./provider";

const MS_PER_CHAR = 4;

/** Emits silence sized to the text, so playback timing and barge-in behave like real speech. */
export class SilentTtsProvider implements TtsProvider {
  readonly name = "silent";
  readonly sampleRate = 24000;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async open() {}

  speak(id: string, text: string, handlers: SpeechHandlers) {
    const timer = setTimeout(() => {
      this.timers.delete(id);
      const samples = Math.round((this.sampleRate * text.length * MS_PER_CHAR) / 1000);
      handlers.onAudio(Buffer.alloc(samples * 2));
      handlers.onDone();
    }, 20);
    this.timers.set(id, timer);
  }

  cancel(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
