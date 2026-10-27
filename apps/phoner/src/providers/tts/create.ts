import type { TtsConfig } from "../../config";
import { CartesiaTtsProvider } from "./cartesia";
import type { TtsProvider } from "./provider";
import { SilentTtsProvider } from "./silent";

export function createTtsProvider(config: TtsConfig): TtsProvider {
  switch (config.provider) {
    case "cartesia":
      return new CartesiaTtsProvider(config);
    case "silent":
      return new SilentTtsProvider();
  }
}
