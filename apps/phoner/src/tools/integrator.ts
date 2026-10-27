import {
  CALL_ID_HEADER,
  type CallEventsRequest,
  Clinic,
  failure,
  TOOL_CALL_ID_HEADER,
  type ToolResult,
} from "@hippo/contracts";

const TIMEOUT_MS = 5000;

export type ToolRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  toolCallId: string;
  callId: string;
  mutating: boolean;
};

export interface Integrator {
  clinic(): Promise<Clinic>;
  startCall(input: { id: string; llmProvider: string; llmModel: string }): Promise<void>;
  endCall(callId: string, reason: string): Promise<void>;
  appendEvents(callId: string, events: CallEventsRequest["events"]): Promise<void>;
  tool(request: ToolRequest): Promise<ToolResult<unknown>>;
}

export class HttpIntegrator implements Integrator {
  constructor(private readonly baseUrl: string) {}

  async clinic() {
    const res = await fetch(`${this.baseUrl}/clinic`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return Clinic.parse(await res.json());
  }

  async startCall(input: { id: string; llmProvider: string; llmModel: string }) {
    await this.post("/calls", input).catch(() => {});
  }

  async endCall(callId: string, reason: string) {
    await this.post(`/calls/${callId}/end`, { reason }).catch(() => {});
  }

  async appendEvents(callId: string, events: CallEventsRequest["events"]) {
    await this.post(`/calls/${callId}/events`, { events }).catch(() => {});
  }

  async tool(request: ToolRequest): Promise<ToolResult<unknown>> {
    const attempt = async () => {
      const res = await fetch(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          [TOOL_CALL_ID_HEADER]: request.toolCallId,
          [CALL_ID_HEADER]: request.callId,
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return (await res.json()) as ToolResult<unknown>;
    };

    try {
      return await attempt();
    } catch (error) {
      if (isConnectionRefused(error)) {
        return failure(
          "SERVICE_UNAVAILABLE",
          "The scheduling system is unreachable. Nothing was changed.",
          {
            retryable: true,
          },
        );
      }
      if (!request.mutating) {
        return failure(
          "SERVICE_UNAVAILABLE",
          "The scheduling system did not respond. Nothing was changed.",
          {
            retryable: true,
          },
        );
      }
      // The first attempt may have committed; the same tool-call id makes the retry safe.
      try {
        return await attempt();
      } catch {
        return failure(
          "OUTCOME_UNKNOWN",
          "It is not known whether the change was saved. Do not tell the caller it succeeded; say the front desk will call to confirm.",
        );
      }
    }
  }

  private post(path: string, body: unknown) {
    return fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}

function isConnectionRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "ECONNREFUSED";
}
