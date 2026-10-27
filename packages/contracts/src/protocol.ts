import { z } from "zod";
import { ToolError } from "./results";

export const CallState = z.enum(["connecting", "listening", "thinking", "speaking", "ended"]);
export type CallState = z.infer<typeof CallState>;

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.start"),
    sampleRate: z.literal(16000),
    scenario: z.string().optional(),
  }),
  z.object({ type: z.literal("user.text"), text: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal("playback.mark"), chunkId: z.string() }),
  z.object({ type: z.literal("session.end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.ready"), callId: z.uuid(), outputSampleRate: z.number() }),
  z.object({ type: z.literal("state"), state: CallState }),
  z.object({ type: z.literal("stt.partial"), text: z.string() }),
  z.object({ type: z.literal("stt.final"), text: z.string() }),
  z.object({ type: z.literal("llm.delta"), turnId: z.string(), text: z.string() }),
  z.object({
    type: z.literal("agent.chunk"),
    turnId: z.string(),
    chunkId: z.string(),
    text: z.string(),
  }),
  z.object({ type: z.literal("audio.chunk"), chunkId: z.string(), bytes: z.number() }),
  z.object({ type: z.literal("audio.end"), chunkId: z.string() }),
  z.object({ type: z.literal("audio.clear"), turnId: z.string() }),
  z.object({
    type: z.literal("agent.interrupted"),
    turnId: z.string(),
    heardText: z.string(),
  }),
  z.object({
    type: z.literal("tool.call"),
    toolCallId: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool.result"),
    toolCallId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: ToolError.optional(),
    latencyMs: z.number(),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("session.ended"), reason: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
