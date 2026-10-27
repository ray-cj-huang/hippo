export type SpeechHandlers = {
  onAudio(pcm: Buffer): void;
  onDone(): void;
  onError(error: Error): void;
};

export interface TtsProvider {
  readonly name: string;
  readonly sampleRate: number;
  open(): Promise<void>;
  speak(id: string, text: string, handlers: SpeechHandlers): void;
  cancel(id: string): void;
  close(): void;
}
