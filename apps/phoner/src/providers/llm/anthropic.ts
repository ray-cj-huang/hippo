import Anthropic from "@anthropic-ai/sdk";
import type { LlmConfig } from "../../config";
import type { LlmEvent, LlmMessage, LlmProvider, LlmTurnRequest, ToolCall } from "./provider";

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(config: LlmConfig) {
    this.model = config.model;
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async *stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
    // Send every tool: changing the list mid-call invalidates earlier thinking blocks.
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 4096,
        system: request.system,
        output_config: { effort: "low" },
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        })),
        messages: toMessages(request.messages),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const block of final.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }
    // A refusal can cut a tool_use off mid-input; never run that turn's tools.
    const safeCalls =
      final.stop_reason === "refusal" || final.stop_reason === "max_tokens" ? [] : toolCalls;
    yield {
      type: "done",
      message: { role: "assistant", text, toolCalls: safeCalls, raw: final.content },
    };
  }
}

function toMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      if (m.raw) {
        out.push({
          role: "assistant",
          content: withText(m.raw as Anthropic.ContentBlockParam[], m.text),
        });
        continue;
      }
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const call of m.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      }
      if (content.length > 0) out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.id,
          content: JSON.stringify(r.result),
        })),
      });
    }
  }
  return out;
}

export function withText(blocks: Anthropic.ContentBlockParam[], text: string) {
  const original = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (original === text) return blocks;
  const rest = blocks.filter((b) => b.type !== "text");
  const at = rest.findIndex((b) => b.type === "tool_use");
  const insert: Anthropic.ContentBlockParam[] = text ? [{ type: "text", text }] : [];
  return at < 0 ? [...rest, ...insert] : [...rest.slice(0, at), ...insert, ...rest.slice(at)];
}
