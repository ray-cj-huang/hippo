"use client";

import type { ServerMessage, ToolError } from "@hippo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Microphone, Player, startMicrophone } from "./audio";
import { PHONER_WS_URL } from "./env";

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export type TranscriptEntry = {
  id: string;
  role: "caller" | "agent";
  text: string;
  interrupted?: { heardText: string };
};

export type ToolEntry = {
  toolCallId: string;
  name: string;
  args: unknown;
  ok?: boolean;
  result?: unknown;
  error?: ToolError;
  latencyMs?: number;
};

export function useCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partial, setPartial] = useState("");
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [level, setLevel] = useState(0);
  const [dbVersion, setDbVersion] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const mic = useRef<Microphone | null>(null);
  const player = useRef<Player | null>(null);
  const pendingChunk = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    mic.current?.stop();
    mic.current = null;
    player.current?.close();
    player.current = null;
    setLevel(0);
  }, []);

  const send = useCallback((message: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(message));
  }, []);

  const handle = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "session.ready":
          setCallId(message.callId);
          player.current = new Player(message.outputSampleRate);
          break;
        case "state":
          setStatus(message.state === "connecting" ? "connecting" : message.state);
          break;
        case "stt.partial":
          setPartial(message.text);
          break;
        case "stt.final":
          setPartial("");
          setTranscript((t) => [
            ...t,
            { id: crypto.randomUUID(), role: "caller", text: message.text },
          ]);
          break;
        case "agent.chunk":
          setTranscript((t) => {
            const last = t.at(-1);
            if (last?.role === "agent" && last.id === message.turnId) {
              return [...t.slice(0, -1), { ...last, text: `${last.text} ${message.text}` }];
            }
            return [...t, { id: message.turnId, role: "agent", text: message.text }];
          });
          break;
        case "agent.interrupted":
          setTranscript((t) =>
            t.map((e) =>
              e.id === message.turnId ? { ...e, interrupted: { heardText: message.heardText } } : e,
            ),
          );
          break;
        case "audio.chunk":
          pendingChunk.current = message.chunkId;
          break;
        case "audio.end":
          player.current?.end(message.chunkId, () =>
            send({ type: "playback.mark", chunkId: message.chunkId }),
          );
          break;
        case "audio.clear":
          player.current?.clear();
          break;
        case "tool.call":
          setTools((t) => [
            ...t,
            { toolCallId: message.toolCallId, name: message.name, args: message.args },
          ]);
          break;
        case "tool.result":
          setTools((t) =>
            t.map((e) =>
              e.toolCallId === message.toolCallId
                ? {
                    ...e,
                    ok: message.ok,
                    result: message.result,
                    error: message.error,
                    latencyMs: message.latencyMs,
                  }
                : e,
            ),
          );
          setDbVersion((v) => v + 1);
          break;
        case "error":
          setErrors((e) => [...e, `${message.code}: ${message.message}`]);
          break;
        case "session.ended":
          setStatus("ended");
          cleanup();
          break;
        default:
          break;
      }
    },
    [cleanup, send],
  );

  const start = useCallback(
    async ({ voice, scenario }: { voice: boolean; scenario?: string }) => {
      setStatus("connecting");
      setTranscript([]);
      setTools([]);
      setErrors([]);
      setPartial("");
      setCallId(null);

      const socket = new WebSocket(PHONER_WS_URL);
      socket.binaryType = "arraybuffer";
      ws.current = socket;

      socket.onopen = async () => {
        socket.send(JSON.stringify({ type: "session.start", sampleRate: 16000, scenario }));
        if (!voice) return;
        try {
          mic.current = await startMicrophone((frame, rms) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(frame);
            setLevel(rms);
          });
        } catch (error) {
          setErrors((e) => [...e, `microphone: ${(error as Error).message}`]);
        }
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (pendingChunk.current) player.current?.enqueue(pendingChunk.current, event.data);
          return;
        }
        handle(JSON.parse(event.data as string) as ServerMessage);
      };
      socket.onerror = () => {
        setStatus("error");
        setErrors((e) => [...e, "Could not reach phoner. Is it running?"]);
      };
      socket.onclose = () => {
        cleanup();
        setStatus((s) => (s === "error" ? s : "ended"));
      };
    },
    [cleanup, handle],
  );

  const end = useCallback(() => {
    send({ type: "session.end" });
    ws.current?.close();
    cleanup();
  }, [cleanup, send]);

  const say = useCallback(
    (text: string) => {
      if (text.trim()) send({ type: "user.text", text: text.trim() });
    },
    [send],
  );

  useEffect(() => () => ws.current?.close(), []);

  const agentLevel = useCallback(() => player.current?.level() ?? 0, []);

  return {
    status,
    callId,
    transcript,
    partial,
    tools,
    errors,
    level,
    agentLevel,
    dbVersion,
    start,
    end,
    say,
  };
}
