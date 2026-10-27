import {
  failure,
  success,
  type ToolName,
  type ToolResult,
  toolDefinitions,
} from "@hippo/contracts";
import type { ToolCall } from "../providers/llm/provider";
import type { Integrator, ToolRequest } from "./integrator";
import { type CallState, checkTool } from "./policy";

export class ToolExecutor {
  // LLMs mistype long signed tokens, so the model only ever sees short slot ids.
  private readonly slotTokens = new Map<string, string>();

  constructor(
    private readonly integrator: Integrator,
    private readonly state: CallState,
  ) {}

  async run(call: ToolCall): Promise<ToolResult<unknown>> {
    if (!(call.name in toolDefinitions)) {
      return failure("VALIDATION_ERROR", `There is no tool named ${call.name}.`);
    }
    const name = call.name as ToolName;
    const blocked = checkTool(name, this.state);
    if (blocked) return blocked;

    const parsed = toolDefinitions[name].args.safeParse(call.args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".") || "args";
      return failure(
        "VALIDATION_ERROR",
        `Invalid ${field}: ${issue?.message ?? "malformed arguments"}. Nothing was done.`,
        { details: { field } },
      );
    }

    if (name === "end_call") {
      this.state.endRequested = true;
      return success({}, "The call will end after you finish speaking.");
    }

    const result = await this.integrator.tool({
      ...this.request(name, parsed.data),
      toolCallId: call.id,
      callId: this.state.callId,
    });
    this.observe(name, result);
    return this.shortenSlotTokens(result);
  }

  private request(
    name: Exclude<ToolName, "end_call">,
    args: Record<string, unknown>,
  ): Omit<ToolRequest, "toolCallId" | "callId"> {
    const slotToken =
      typeof args.slotId === "string"
        ? (this.slotTokens.get(args.slotId) ?? args.slotId)
        : undefined;
    switch (name) {
      case "get_availability":
        return {
          method: "POST",
          path: "/availability",
          body: args,
          mutating: false,
        };
      case "verify_patient":
        return { method: "POST", path: "/patients/verify", body: args, mutating: true };
      case "list_appointments":
        return { method: "GET", path: "/appointments", mutating: false };
      case "book_appointment":
        return {
          method: "POST",
          path: "/appointments",
          body: {
            reason: args.reason,
            confirmDuplicate: args.confirmDuplicate,
            slotToken,
          },
          mutating: true,
        };
      case "cancel_appointment":
        return {
          method: "POST",
          path: `/appointments/${args.appointmentId}/cancel`,
          mutating: true,
        };
      case "reschedule_appointment":
        return {
          method: "POST",
          path: `/appointments/${args.appointmentId}/reschedule`,
          body: { slotToken },
          mutating: true,
        };
    }
  }

  private observe(name: ToolName, result: ToolResult<unknown>) {
    if (!result.ok) {
      if (result.error.code === "SLOT_TAKEN" || result.error.code === "SLOT_UNAVAILABLE") {
        this.state.availabilityChecked = true;
      }
      return;
    }
    const data = result.data as { patientId?: string; slots?: unknown[] };
    if (name === "verify_patient" && data.patientId) this.state.patientId = data.patientId;
    if (name === "get_availability" && data.slots?.length) this.state.availabilityChecked = true;
  }

  private shortenSlotTokens<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => this.shortenSlotTokens(v)) as T;
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === "slotToken" && typeof v === "string") {
        const slotId = `slot_${this.slotTokens.size + 1}`;
        this.slotTokens.set(slotId, v);
        out.slotId = slotId;
      } else {
        out[key] = this.shortenSlotTokens(v);
      }
    }
    return out as T;
  }
}
