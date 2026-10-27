import type { ToolName } from "@hippo/contracts";

export type ToolCall = { id: string; name: string; args: unknown };

export type AssistantMessage = {
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
  /** Provider-native content (thought signatures, thinking blocks) replayed verbatim on the next request. */
  raw?: unknown;
};

export type LlmMessage =
  | { role: "user"; text: string }
  | AssistantMessage
  | { role: "tool"; results: { id: string; name: string; result: unknown }[] };

export type ToolSpec = { name: ToolName; description: string; parameters: Record<string, unknown> };

export type LlmTurnRequest = {
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  allowedTools: ToolName[];
};

export type LlmEvent = { type: "text"; text: string } | { type: "done"; message: AssistantMessage };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<LlmEvent>;
}
