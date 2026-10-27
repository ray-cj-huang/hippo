import type { LlmConfig } from "../../config";
import { AnthropicLlmProvider } from "./anthropic";
import { GoogleLlmProvider } from "./google";
import type { LlmProvider } from "./provider";
import { ScriptedLlmProvider } from "./scripted";

export function createLlmProvider(config: LlmConfig, scenario?: string): LlmProvider {
  switch (config.provider) {
    case "google":
      return new GoogleLlmProvider(config);
    case "anthropic":
      return new AnthropicLlmProvider(config);
    case "scripted": {
      const provider = new ScriptedLlmProvider(config);
      provider.load(scenario ?? "default");
      return provider;
    }
  }
}
