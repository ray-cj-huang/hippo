import type { SttConfig } from "../../config";
import { DeepgramFluxSttProvider } from "./deepgram-flux";
import { NoSttProvider } from "./none";
import type { SttProvider } from "./provider";

export function createSttProvider(config: SttConfig): SttProvider {
  switch (config.provider) {
    case "deepgram-flux":
      return new DeepgramFluxSttProvider(config);
    case "none":
      return new NoSttProvider();
  }
}
