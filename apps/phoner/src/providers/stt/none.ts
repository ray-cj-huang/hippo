import type { SttProvider, SttStream } from "./provider";

/** Ignores audio; caller turns arrive as typed `user.text` messages instead. */
export class NoSttProvider implements SttProvider {
  readonly name = "none";

  async connect(): Promise<SttStream> {
    return { send: () => {}, close: async () => {} };
  }
}
