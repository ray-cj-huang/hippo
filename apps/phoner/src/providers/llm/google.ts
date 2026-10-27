import { type Content, GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import type { LlmConfig } from "../../config";
import type {
  AssistantMessage,
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmTurnRequest,
  ToolCall,
} from "./provider";

const GENERATED_ID = "gen_";

export class GoogleLlmProvider implements LlmProvider {
  readonly name = "google";
  readonly model: string;
  private readonly ai: GoogleGenAI;

  constructor(config: LlmConfig) {
    this.model = config.model;
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  async *stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
    const allowed = new Set(request.allowedTools);
    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: request.system,
        tools: [
          {
            functionDeclarations: request.tools
              .filter((t) => allowed.has(t.name))
              .map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters,
              })),
          },
        ],
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });

    const parts: Part[] = [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(part);
        if (part.text && !part.thought) {
          text += part.text;
          yield { type: "text", text: part.text };
        }
        if (part.functionCall?.name) {
          toolCalls.push({
            id: part.functionCall.id ?? `${GENERATED_ID}${crypto.randomUUID()}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          });
        }
      }
    }

    const message: AssistantMessage = {
      role: "assistant",
      text,
      toolCalls,
      raw: { role: "model", parts },
    };
    yield { type: "done", message };
  }
}

function toContents(messages: LlmMessage[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "assistant") {
      if (m.raw) {
        contents.push(withText(m.raw as Content, m.text));
        continue;
      }
      const parts: Part[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const call of m.toolCalls) {
        parts.push({
          functionCall: {
            ...nativeId(call.id),
            name: call.name,
            args: call.args as Record<string, unknown>,
          },
        });
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else {
      contents.push({
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: { ...nativeId(r.id), name: r.name, response: { result: r.result } },
        })),
      });
    }
  }
  return contents;
}

export function withText(content: Content, text: string): Content {
  const parts = content.parts ?? [];
  const isText = (p: Part) => Boolean(p.text) && !p.thought;
  if (
    parts
      .filter(isText)
      .map((p) => p.text)
      .join("") === text
  )
    return content;
  const rest = parts.filter((p) => !isText(p));
  const at = rest.findIndex((p) => p.functionCall);
  const insert: Part[] = text ? [{ text }] : [];
  return {
    ...content,
    parts: at < 0 ? [...rest, ...insert] : [...rest.slice(0, at), ...insert, ...rest.slice(at)],
  };
}

function nativeId(id: string) {
  return id.startsWith(GENERATED_ID) ? {} : { id };
}
