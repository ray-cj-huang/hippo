import type { CallEventsRequest } from "@hippo/contracts";
import { callEvents, calls } from "@hippo/db";
import { eq } from "drizzle-orm";
import type { Ctx } from "../context";

export async function startCall(
  ctx: Ctx,
  input: { id: string; llmProvider: string; llmModel: string },
) {
  await ctx.db
    .insert(calls)
    .values(input)
    .onConflictDoUpdate({
      target: calls.id,
      set: { llmProvider: input.llmProvider, llmModel: input.llmModel },
    });
}

export async function endCall(ctx: Ctx, callId: string, reason: string) {
  await ctx.db
    .update(calls)
    .set({ endedAt: ctx.now(), endReason: reason })
    .where(eq(calls.id, callId));
}

export async function appendCallEvents(ctx: Ctx, callId: string, req: CallEventsRequest) {
  if (req.events.length === 0) return;
  await ctx.db.insert(callEvents).values(
    req.events.map((e) => ({
      callId,
      type: e.type,
      payload: e.payload,
      at: e.at ? new Date(e.at) : ctx.now(),
    })),
  );
}
