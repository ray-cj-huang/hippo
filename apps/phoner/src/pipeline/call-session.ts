import {
  type ClientMessage,
  toolDefinitions,
  toolJsonSchema,
  toolNames,
  type CallState as UiState,
} from "@hippo/contracts";
import { buildSystemPrompt, greeting } from "../prompt/system-prompt";
import type { Guardrail } from "../providers/guardrail/guardrail";
import type {
  AssistantMessage,
  LlmMessage,
  LlmProvider,
  ToolSpec,
} from "../providers/llm/provider";
import type { SttProvider, SttStream } from "../providers/stt/provider";
import type { TtsProvider } from "../providers/tts/provider";
import { ToolExecutor } from "../tools/executor";
import type { Integrator } from "../tools/integrator";
import { allowedTools, type CallState } from "../tools/policy";
import type { CallTransport } from "../transport/transport";
import { SentenceChunker } from "./sentence-chunker";
import { SpeechQueue } from "./speech-queue";

const MAX_LLM_ROUNDS = 6;

const toolSpecs: ToolSpec[] = toolNames.map((name) => ({
  name,
  description: toolDefinitions[name].description,
  parameters: toolJsonSchema(name),
}));

export type SessionDeps = {
  transport: CallTransport;
  llm: LlmProvider;
  stt: SttProvider;
  tts: TtsProvider;
  guardrail: Guardrail;
  integrator: Integrator;
  ttsConcurrency?: number;
  now?: () => Date;
};

type Turn = {
  id: string;
  controller: AbortController;
  done: Promise<void>;
  generating: boolean;
  spoken: { index: number; chunkIds: string[] }[];
};

export class CallSession {
  private readonly state: CallState = {
    callId: crypto.randomUUID(),
    patientId: null,
    availabilityChecked: false,
    endRequested: false,
  };
  private readonly history: LlmMessage[] = [];
  private readonly tools: ToolExecutor;
  private readonly speech: SpeechQueue;
  private system = "";
  private stt: SttStream | null = null;
  private uiState: UiState = "connecting";
  private turn: Turn | null = null;
  private interruption: Promise<void> | null = null;
  private turnCount = 0;
  private chunkCount = 0;
  private ended = false;

  constructor(private readonly deps: SessionDeps) {
    this.tools = new ToolExecutor(deps.integrator, this.state);
    this.speech = new SpeechQueue(
      deps.tts,
      deps.transport,
      {
        onFirstAudio: () => this.setState("speaking"),
        onIdle: () => this.onSpeechIdle(),
        onError: (error) => this.reportError("tts", error),
      },
      deps.ttsConcurrency,
    );
  }

  async start() {
    const { transport, integrator, llm, stt, tts } = this.deps;
    transport.listen({
      onAudio: (frame) => this.stt?.send(frame),
      onMessage: (message) => void this.onClientMessage(message),
      onClose: () => void this.end("caller_hangup"),
    });

    try {
      const clinic = await integrator.clinic();
      this.system = buildSystemPrompt(clinic, this.now());
      const [, sttStream] = await Promise.all([
        integrator.startCall({ id: this.state.callId, llmProvider: llm.name, llmModel: llm.model }),
        stt.connect({
          onStartOfTurn: () => void this.onCallerStartedSpeaking(),
          onUpdate: (text) => transport.send({ type: "stt.partial", text }),
          onEndOfTurn: (text) => void this.onCallerTurn(text),
          onError: (error) => this.reportError("stt", error),
        }),
        tts.open(),
      ]);
      this.stt = sttStream;
      transport.send({
        type: "session.ready",
        callId: this.state.callId,
        outputSampleRate: tts.sampleRate,
      });

      const hello = greeting(clinic);
      this.history.push({ role: "assistant", text: hello, toolCalls: [] });
      this.turn = {
        id: "t0",
        controller: new AbortController(),
        done: Promise.resolve(),
        generating: false,
        spoken: [{ index: this.history.length - 1, chunkIds: ["greeting"] }],
      };
      this.setState("thinking");
      this.speech.beginTurn();
      transport.send({ type: "agent.chunk", turnId: "t0", chunkId: "greeting", text: hello });
      this.speak("greeting", hello);
      this.logEvent("agent_turn", { text: hello });
    } catch (error) {
      this.reportError("start", error);
      await this.end("error");
    }
  }

  private async onClientMessage(message: ClientMessage) {
    if (message.type === "playback.mark") this.speech.markPlayed(message.chunkId);
    else if (message.type === "user.text") await this.onCallerTurn(message.text);
    else if (message.type === "session.end") await this.end("caller_hangup");
  }

  private async onCallerStartedSpeaking() {
    if (this.uiState === "thinking" || this.uiState === "speaking") await this.bargeIn();
  }

  private async onCallerTurn(text: string) {
    if (this.ended || !text.trim()) return;
    if (this.uiState === "thinking" || this.uiState === "speaking") await this.bargeIn();
    this.deps.transport.send({ type: "stt.final", text });
    this.history.push({ role: "user", text });
    this.logEvent("user_turn", { text });
    this.runTurn();
  }

  private runTurn() {
    const id = `t${++this.turnCount}`;
    const controller = new AbortController();
    const turn: Turn = {
      id,
      controller,
      generating: true,
      done: Promise.resolve(),
      spoken: [],
    };
    this.turn = turn;
    this.setState("thinking");
    this.speech.beginTurn();
    turn.done = this.generate(turn).finally(() => {
      turn.generating = false;
      if (this.turn === turn && this.speech.idle) this.onSpeechIdle();
    });
  }

  private async generate(turn: Turn) {
    const { llm, transport, guardrail } = this.deps;
    const signal = turn.controller.signal;
    const turnResults: unknown[] = [];

    for (let round = 0; round < MAX_LLM_ROUNDS; round++) {
      const chunker = new SentenceChunker();
      const spoken: string[] = [];
      let message: AssistantMessage | null = null;

      const emit = async (sentence: string) => {
        const verdict = await guardrail.check(sentence, {
          patientId: this.state.patientId,
          turnToolResults: turnResults,
        });
        if (signal.aborted || verdict.action === "block") return;
        const text = verdict.action === "rewrite" ? verdict.text : sentence;
        const chunkId = `${turn.id}c${++this.chunkCount}`;
        spoken.push(chunkId);
        transport.send({ type: "agent.chunk", turnId: turn.id, chunkId, text });
        this.speak(chunkId, text);
      };

      try {
        for await (const event of llm.stream(
          {
            system: this.system,
            messages: this.history,
            tools: toolSpecs,
            allowedTools: allowedTools(this.state),
          },
          signal,
        )) {
          if (event.type === "text") {
            transport.send({ type: "llm.delta", turnId: turn.id, text: event.text });
            for (const sentence of chunker.push(event.text)) await emit(sentence);
          } else {
            message = event.message;
          }
        }
        for (const sentence of chunker.flush()) await emit(sentence);
      } catch (error) {
        if (signal.aborted) {
          const heard = this.speech.heard(spoken);
          if (heard) {
            this.history.push({ role: "assistant", text: heard, toolCalls: [] });
            turn.spoken.push({ index: this.history.length - 1, chunkIds: spoken });
          }
          return;
        }
        this.reportError("llm", error);
        await this.recoverFromError(turn);
        return;
      }

      if (!message) return;
      this.history.push(message);
      if (spoken.length > 0) turn.spoken.push({ index: this.history.length - 1, chunkIds: spoken });
      if (message.text) this.logEvent("agent_turn", { text: message.text });
      if (message.toolCalls.length === 0) return;

      // In-flight tool calls are never aborted: a booking may already be committed.
      const results = [];
      for (const call of message.toolCalls) {
        transport.send({
          type: "tool.call",
          toolCallId: call.id,
          name: call.name,
          args: call.args,
        });
        const started = Date.now();
        const result = await this.tools.run(call);
        turnResults.push(result);
        transport.send({
          type: "tool.result",
          toolCallId: call.id,
          name: call.name,
          ok: result.ok,
          ...(result.ok ? { result: result.data } : { error: result.error }),
          latencyMs: Date.now() - started,
        });
        if (!result.ok && result.error.code === "OUTCOME_UNKNOWN")
          this.logEvent("flagged", { tool: call.name, args: call.args });
        results.push({ id: call.id, name: call.name, result });
      }
      this.history.push({ role: "tool", results });
      if (signal.aborted) return;
      if (this.state.endRequested) {
        if (turn.spoken.length === 0) this.sayGoodbye(turn);
        return;
      }
    }
  }

  private async recoverFromError(turn: Turn) {
    const text = "Sorry, I'm having trouble on my end. Could you say that again?";
    this.history.push({ role: "assistant", text, toolCalls: [] });
    const chunkId = `${turn.id}err`;
    this.deps.transport.send({ type: "agent.chunk", turnId: turn.id, chunkId, text });
    this.speak(chunkId, text);
  }

  private sayGoodbye(turn: Turn) {
    const text = "Thank you for calling. Goodbye!";
    this.history.push({ role: "assistant", text, toolCalls: [] });
    const chunkId = `${turn.id}bye`;
    turn.spoken.push({ index: this.history.length - 1, chunkIds: [chunkId] });
    this.deps.transport.send({ type: "agent.chunk", turnId: turn.id, chunkId, text });
    this.speak(chunkId, text);
  }

  private speak(chunkId: string, text: string) {
    this.speech.enqueue(chunkId, text);
  }

  private bargeIn() {
    this.interruption ??= this.interrupt().finally(() => {
      this.interruption = null;
    });
    return this.interruption;
  }

  private async interrupt() {
    const turn = this.turn;
    this.speech.clear();
    if (turn) {
      this.deps.transport.send({ type: "audio.clear", turnId: turn.id });
      const cutShort = turn.generating;
      turn.controller.abort();
      await turn.done;
      // Playback lags generation and tool calls, so any spoken message of the turn may be unheard.
      const truncated = this.truncateToHeard(turn);
      if (cutShort || truncated) {
        const heard = turn.spoken
          .map((s) => this.speech.heard(s.chunkIds))
          .filter(Boolean)
          .join(" ");
        this.deps.transport.send({ type: "agent.interrupted", turnId: turn.id, heardText: heard });
        this.logEvent("barge_in", { heardText: heard });
      }
    }
    this.setState("listening");
  }

  private truncateToHeard(turn: Turn) {
    let truncated = false;
    for (const { index, chunkIds } of turn.spoken) {
      const message = this.history[index];
      if (message?.role !== "assistant") continue;
      const heard = this.speech.heard(chunkIds);
      if (heard === message.text) continue;
      // Tool-call messages keep raw: providers must replay their thought signatures.
      const raw = message.toolCalls.length > 0 ? message.raw : undefined;
      this.history[index] = { ...message, text: heard, raw };
      truncated = true;
    }
    return truncated;
  }

  private onSpeechIdle() {
    if (this.turn?.generating) return;
    if (this.state.endRequested) {
      void this.end("end_call");
      return;
    }
    this.setState("listening");
  }

  private setState(state: UiState) {
    if (this.uiState === state || this.ended) return;
    this.uiState = state;
    this.deps.transport.send({ type: "state", state });
  }

  private reportError(source: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", source, callId: this.state.callId, message }));
    this.deps.transport.send({ type: "error", code: source, message });
    this.logEvent("error", { source, message });
  }

  private logEvent(
    type: "user_turn" | "agent_turn" | "barge_in" | "error" | "flagged",
    payload: Record<string, unknown>,
  ) {
    void this.deps.integrator.appendEvents(this.state.callId, [
      { type, payload, at: this.now().toISOString() },
    ]);
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async end(reason: string) {
    if (this.ended) return;
    this.turn?.controller.abort();
    this.speech.clear();
    this.deps.transport.send({ type: "session.ended", reason });
    this.setState("ended");
    this.ended = true;
    await this.stt?.close();
    this.deps.tts.close();
    await this.deps.integrator.endCall(this.state.callId, reason);
    this.deps.transport.close();
  }
}
