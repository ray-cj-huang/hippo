import type { LlmConfig } from "../../config";
import { GoogleLlmProvider } from "./google";
import type { LlmProvider } from "./provider";
import { ScriptedLlmProvider } from "./scripted";

export function createLlmProvider(config: LlmConfig, scenario?: string): LlmProvider {
  switch (config.provider) {
    case "google":
      return new GoogleLlmProvider(config);
    case "scripted": {
      const provider = new ScriptedLlmProvider(config);
      provider.load(scenario ?? "default");
      return provider;
    }
  }
}
