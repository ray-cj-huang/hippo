export type SttHandlers = {
  onStartOfTurn(): void;
  onUpdate(text: string): void;
  onEndOfTurn(text: string): void;
  onError(error: Error): void;
};

export interface SttStream {
  send(frame: Buffer): void;
  close(): Promise<void>;
}

export interface SttProvider {
  readonly name: string;
  connect(handlers: SttHandlers): Promise<SttStream>;
}
