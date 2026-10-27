import type { GuardrailConfig } from "../../config";

export type GuardrailContext = { patientId: string | null; turnToolResults: unknown[] };

export type GuardrailVerdict =
  | { action: "allow" }
  | { action: "rewrite"; text: string; reason: string }
  | { action: "block"; reason: string };

export interface Guardrail {
  readonly name: string;
  check(sentence: string, context: GuardrailContext): Promise<GuardrailVerdict>;
}

export class NoopGuardrail implements Guardrail {
  readonly name = "noop";
  async check(): Promise<GuardrailVerdict> {
    return { action: "allow" };
  }
}

export function createGuardrail(config: GuardrailConfig): Guardrail {
  switch (config.provider) {
    case "noop":
      return new NoopGuardrail();
  }
}
