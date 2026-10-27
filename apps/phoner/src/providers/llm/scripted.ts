import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { LlmConfig } from "../../config";
import type { LlmEvent, LlmMessage, LlmProvider, LlmTurnRequest, ToolCall } from "./provider";

const Step = z.union([
  z.object({ say: z.string() }),
  z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()).default({}) }),
]);
const Scenario = z.object({ turns: z.array(z.array(Step)) });
type Step = z.infer<typeof Step>;

const FALLBACK: Step[] = [{ say: "Is there anything else I can help you with?" }];

export class ScriptedLlmProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model: string;
  private turn = -1;
  private step = 0;
  private turns: Step[][] = [];

  constructor(private readonly config: LlmConfig) {
    this.model = "scripted";
  }

  load(scenario: string) {
    const file = join(this.config.scenariosDir, `${scenario}.yaml`);
    this.turns = Scenario.parse(parse(readFileSync(file, "utf8"))).turns;
  }

  async *stream(request: LlmTurnRequest, signal: AbortSignal): AsyncIterable<LlmEvent> {
    if (request.messages.at(-1)?.role === "user") {
      this.turn += 1;
      this.step = 0;
    }
    const steps = this.turns[this.turn] ?? FALLBACK;
    let text = "";
    const toolCalls: ToolCall[] = [];

    while (this.step < steps.length) {
      signal.throwIfAborted();
      const step = steps[this.step++] as Step;
      if ("say" in step) {
        const piece = text ? ` ${step.say}` : step.say;
        text += piece;
        for (const word of piece.split(/(?<= )/)) {
          await new Promise((r) => setTimeout(r, 5));
          signal.throwIfAborted();
          yield { type: "text", text: word };
        }
      } else {
        toolCalls.push({
          id: `scripted_${crypto.randomUUID()}`,
          name: step.tool,
          args: resolve(step.args, request.messages),
        });
        break;
      }
    }
    yield { type: "done", message: { role: "assistant", text, toolCalls } };
  }
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextWeekday(name: string): string {
  const timeZone = process.env.CLINIC_TIMEZONE ?? "America/Los_Angeles";
  const today = new Date(new Date().toLocaleString("en-US", { timeZone }));
  const target = WEEKDAYS.indexOf(name.toLowerCase());
  const days = ((target - today.getDay() + 6) % 7) + 1;
  today.setDate(today.getDate() + days);
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function resolve(value: unknown, messages: LlmMessage[]): unknown {
  if (typeof value === "string" && value.startsWith("$date.next"))
    return nextWeekday(value.slice("$date.next".length));
  if (typeof value === "string" && value.startsWith("$")) {
    const [tool, ...path] = value.slice(1).split(".");
    const result = latestResult(messages, tool ?? "") as { data?: unknown } | undefined;
    return path.reduce<unknown>(
      (acc, key) => (acc as Record<string, unknown> | undefined)?.[key],
      result?.data,
    );
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, messages));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, messages)]));
  }
  return value;
}

function latestResult(messages: LlmMessage[], tool: string): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "tool") continue;
    const hit = m.results.findLast((r) => r.name === tool);
    if (hit) return hit.result;
  }
  return undefined;
}
