import { fileURLToPath } from "node:url";
import {
  type Clinic,
  failure,
  type ServerMessage,
  success,
  type ToolResult,
} from "@hippo/contracts";
import { describe, expect, it } from "vitest";
import { CallSession } from "../../../src/pipeline/call-session";
import { NoopGuardrail } from "../../../src/providers/guardrail/guardrail";
import type { LlmMessage, LlmTurnRequest } from "../../../src/providers/llm/provider";
import { ScriptedLlmProvider } from "../../../src/providers/llm/scripted";
import type { SttHandlers, SttProvider } from "../../../src/providers/stt/provider";
import { SilentTtsProvider } from "../../../src/providers/tts/silent";
import type { Integrator, ToolRequest } from "../../../src/tools/integrator";
import type { CallTransport, TransportHandlers } from "../../../src/transport/transport";

const clinic: Clinic = {
  name: "Hippo Medical Center",
  timezone: "America/Los_Angeles",
  today: "2026-10-27",
  bookingWindow: { earliest: "2026-10-28", latest: "2026-11-26" },
  specialties: [
    { id: "orthopedics", name: "Orthopedics", isPrimaryCare: false, minAge: null, maxAge: null },
  ],
  doctors: [],
};

class FakeTransport implements CallTransport {
  readonly sent: ServerMessage[] = [];
  private handlers: TransportHandlers | null = null;
  closed = false;

  send(message: ServerMessage) {
    this.sent.push(message);
    // Simulate the browser finishing playback of each sentence.
    if (message.type === "audio.end")
      setTimeout(
        () => this.handlers?.onMessage({ type: "playback.mark", chunkId: message.chunkId }),
        5,
      );
  }
  sendAudio() {}
  listen(handlers: TransportHandlers) {
    this.handlers = handlers;
  }
  close() {
    this.closed = true;
  }
  say(text: string) {
    this.handlers?.onMessage({ type: "user.text", text });
  }
  of<T extends ServerMessage["type"]>(type: T) {
    return this.sent.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }
  async until(predicate: () => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`timed out; last messages: ${JSON.stringify(this.sent.slice(-5))}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  async untilListening() {
    const count = this.of("state").filter((s) => s.state === "listening").length;
    await this.until(() => this.of("state").filter((s) => s.state === "listening").length > count);
  }
}

class FakeStt implements SttProvider {
  readonly name = "fake";
  handlers: SttHandlers | null = null;

  async connect(handlers: SttHandlers) {
    this.handlers = handlers;
    return { send: () => {}, close: async () => {} };
  }
}

class RecordingLlm extends ScriptedLlmProvider {
  readonly requests: LlmMessage[][] = [];

  override stream(request: LlmTurnRequest, signal: AbortSignal) {
    this.requests.push(structuredClone(request.messages));
    return super.stream(request, signal);
  }
}

class FakeIntegrator implements Integrator {
  readonly requests: ToolRequest[] = [];
  hold: Promise<void> | null = null;
  private registered = false;

  async clinic() {
    return clinic;
  }
  async startCall() {}
  async endCall() {}
  async appendEvents() {}
  async tool(request: ToolRequest): Promise<ToolResult<unknown>> {
    this.requests.push(request);
    await this.hold;
    const body = request.body as Record<string, unknown>;
    if (request.path === "/patients/verify") {
      if (body.firstName === "John" || this.registered) {
        return success(
          {
            status: "verified",
            patientId: "00000000-0000-4000-8000-000000001001",
            upcomingAppointments: [],
          },
          "Verified.",
        );
      }
      if (!body.newPatient)
        return failure("PATIENT_NOT_FOUND", "Not found. No record was created.");
      this.registered = true;
      return success(
        {
          status: "registered",
          patientId: "00000000-0000-4000-8000-000000001009",
          upcomingAppointments: [],
        },
        "Registered.",
      );
    }
    if (request.path === "/availability") {
      return success(
        { slots: [{ slotToken: "tok-1", label: "Monday at 9:00 AM" }], nextAvailable: null },
        "1 open slot.",
      );
    }
    if (request.path === "/appointments")
      return success({ appointmentId: "a1", label: "Monday at 9:00 AM" }, "Booked.");
    return failure("INTERNAL_ERROR", "unexpected");
  }
}

function startSession(
  scenario: string,
  scenariosDir = fileURLToPath(new URL("../../../../e2e/scenarios", import.meta.url)),
) {
  const transport = new FakeTransport();
  const integrator = new FakeIntegrator();
  const stt = new FakeStt();
  const llm = new RecordingLlm({
    provider: "scripted",
    model: "scripted",
    geminiApiKey: "",
    scenariosDir,
  });
  llm.load(scenario);
  const session = new CallSession({
    transport,
    llm,
    stt,
    tts: new SilentTtsProvider(),
    guardrail: new NoopGuardrail(),
    integrator,
  });
  return { transport, integrator, llm, stt, session };
}

const testScenarios = fileURLToPath(new URL("../../scenarios", import.meta.url));

describe("CallSession", () => {
  it("runs a new-patient booking end to end and hangs up", async () => {
    const { transport, integrator, session } = startSession("new-patient-book");
    await session.start();
    await transport.untilListening();

    for (const line of [
      "I hurt my ankle",
      "Maria Gonzalez",
      "Yes, March 3rd 1990",
      "Yes, that's right",
      "Yes, I'm new",
      "Yes please",
    ]) {
      transport.say(line);
      await transport.untilListening();
    }
    transport.say("No, that's all");
    await transport.until(() => transport.closed);

    expect(integrator.requests.map((r) => r.path)).toEqual([
      "/patients/verify",
      "/patients/verify",
      "/availability",
      "/appointments",
    ]);
    const booking = integrator.requests.at(-1);
    expect(booking?.body).toEqual({ reason: expect.any(String), slotToken: "tok-1" });
    expect(booking?.toolCallId).toBeTruthy();
    expect(transport.of("session.ended")[0]?.reason).toBe("end_call");
  });

  it("says goodbye before hanging up when end_call comes without speech", async () => {
    const { transport, session } = startSession("silent-end-call");
    await session.start();
    await transport.untilListening();
    transport.say("That's it");
    await transport.until(() => transport.closed);

    expect(transport.of("agent.chunk").at(-1)?.text).toBe("Thank you for calling. Goodbye!");
    expect(transport.of("session.ended")[0]?.reason).toBe("end_call");
  });

  it("blocks booking before availability without calling the integrator", async () => {
    const { transport, integrator, session } = startSession(
      "book-without-availability",
      testScenarios,
    );
    await session.start();
    await transport.untilListening();
    transport.say("Book me with anyone, John Smith, May 12 1980");
    await transport.untilListening();

    expect(integrator.requests.map((r) => r.path)).toEqual(["/patients/verify"]);
    expect(transport.of("tool.result").at(-1)).toMatchObject({
      name: "book_appointment",
      ok: false,
      error: { code: "AVAILABILITY_REQUIRED" },
    });
  });

  it("stops speaking and keeps only what was heard when the caller barges in", async () => {
    const { transport, session } = startSession("long-answer", testScenarios);
    await session.start();
    await transport.untilListening();
    transport.say("Tell me about the clinic");
    await transport.until(() => transport.of("audio.end").length >= 2);
    await new Promise((r) => setTimeout(r, 30));
    transport.say("Actually, I need to book");
    await transport.untilListening();

    const interrupted = transport.of("agent.interrupted")[0];
    expect(transport.of("audio.clear")).toHaveLength(1);
    expect(interrupted?.heardText.startsWith("Let me tell you about our clinic.")).toBe(true);
    expect(interrupted?.heardText).not.toContain("near the station");
  });

  it("stops the greeting when the caller talks over it", async () => {
    const { transport, llm, session } = startSession("long-answer", testScenarios);
    await session.start();
    transport.say("Hi, I need an appointment");
    await transport.until(() => llm.requests.length === 1);

    expect(transport.of("audio.clear")).toEqual([{ type: "audio.clear", turnId: "t0" }]);
    expect(transport.of("agent.interrupted")).toEqual([
      { type: "agent.interrupted", turnId: "t0", heardText: "" },
    ]);
    expect(llm.requests[0]?.[0]).toMatchObject({ role: "assistant", text: "" });
  });

  it("keeps only what was heard when the caller interrupts during a tool call", async () => {
    const { transport, integrator, llm, stt, session } = startSession(
      "speak-then-tool",
      testScenarios,
    );
    let release = () => {};
    integrator.hold = new Promise((r) => {
      release = r;
    });
    await session.start();
    await transport.untilListening();
    transport.say("I'd like to book");
    await transport.until(
      () => transport.of("tool.call").length === 1 && transport.of("audio.end").length >= 1,
    );
    await new Promise((r) => setTimeout(r, 10));
    stt.handlers?.onStartOfTurn();
    stt.handlers?.onEndOfTurn("Wait, one more thing");
    setTimeout(release, 20);
    await transport.until(() => llm.requests.length === 2);

    const interrupted = transport.of("agent.interrupted");
    expect(interrupted).toHaveLength(1);
    expect(transport.of("audio.clear")).toHaveLength(1);
    const heard = interrupted[0]?.heardText ?? "";
    expect(heard.startsWith("Let me look you up.")).toBe(true);
    expect(heard).not.toContain("Thanks for waiting");
    expect(transport.of("tool.result")[0]).toMatchObject({ name: "verify_patient", ok: true });

    const history = llm.requests[1] ?? [];
    const withTool = history.findIndex((m) => m.role === "assistant" && m.toolCalls.length > 0);
    expect(history[withTool]).toMatchObject({ text: heard });
    expect(history[withTool + 1]?.role).toBe("tool");
    expect(history.at(-1)).toEqual({ role: "user", text: "Wait, one more thing" });
    expect(JSON.stringify(history)).not.toContain("Found you");
  });
});
