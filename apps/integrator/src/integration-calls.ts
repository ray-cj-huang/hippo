import {
  CALL_ID_HEADER,
  failure,
  TOOL_CALL_ID_HEADER,
  type ToolName,
  type ToolResult,
} from "@hippo/contracts";
import { calls, type Db, integrationCalls } from "@hippo/db";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { claimKey, completeKey, hashRequest, type KeyRef, releaseKey } from "./idempotency";

export type RecorderVariables = {
  integrationCallId: string;
  callId: string | null;
  patientId: string | null;
  idempotencyKey: KeyRef | null;
};

type Recorded = { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } };

const Uuid = z.uuid();
const MUTATING = new Set<ToolName>([
  "verify_patient",
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
]);

export function recordIntegrationCall(db: Db, tool: ToolName, now: () => Date) {
  return createMiddleware<{ Variables: RecorderVariables }>(async (c, next) => {
    const started = Date.now();
    const toolCallId = c.req.header(TOOL_CALL_ID_HEADER) ?? null;
    const callIdHeader = c.req.header(CALL_ID_HEADER);
    const callId = callIdHeader && Uuid.safeParse(callIdHeader).success ? callIdHeader : null;
    const request = { params: c.req.param(), body: await c.req.json().catch(() => null) };

    if (toolCallId && MUTATING.has(tool) && !callId) {
      return c.json(
        failure("VALIDATION_ERROR", `${CALL_ID_HEADER} is required with ${TOOL_CALL_ID_HEADER}.`),
        400,
      );
    }
    // phoner may have failed to register the call; the audit log still needs the row.
    if (callId)
      await db.insert(calls).values({ id: callId }).onConflictDoNothing({ target: calls.id });
    const callPatientId = callId ? await verifiedPatient(db, callId) : null;

    const [row] = await db
      .insert(integrationCalls)
      .values({ callId, toolCallId, tool, request })
      .returning({ id: integrationCalls.id });
    if (!row) throw new Error("integration_calls insert returned no row");

    const finish = async (
      status: number,
      response: Recorded | null,
      replayOf: string | null = null,
    ) => {
      await db
        .update(integrationCalls)
        .set({
          response,
          httpStatus: status,
          ok: response?.ok ?? false,
          errorCode: response?.error?.code ?? null,
          patientId: patientIdFrom(response?.data) ?? callPatientId,
          replayOf,
          latencyMs: Date.now() - started,
          completedAt: new Date(),
        })
        .where(eq(integrationCalls.id, row.id));
    };

    const key: KeyRef | null =
      toolCallId && callId && MUTATING.has(tool) ? { callId, toolCallId, tool } : null;
    if (key) {
      const claim = await claimKey(db, key, hashRequest(request), row.id, now());
      if (claim.kind !== "acquired") {
        const replay = claim.kind === "replay";
        const status = replay ? claim.httpStatus : claim.kind === "busy" ? 409 : 422;
        const body: Recorded = replay
          ? markReplayed(claim.response as Recorded)
          : claim.kind === "busy"
            ? failure(
                "SERVICE_UNAVAILABLE",
                "This exact request is still being processed. Wait a moment and retry.",
                {
                  retryable: true,
                },
              )
            : failure(
                "VALIDATION_ERROR",
                `${TOOL_CALL_ID_HEADER} was already used for a different request.`,
              );
        await finish(status, body, replay ? claim.integrationCallId : null);
        return c.json(body, status as ContentfulStatusCode);
      }
    }

    c.set("integrationCallId", row.id);
    c.set("callId", callId);
    c.set("patientId", callPatientId);
    c.set("idempotencyKey", key);
    await next();

    const response = (await c.res
      .clone()
      .json()
      .catch(() => null)) as Recorded | null;
    if (key) {
      // A 5xx means the change rolled back, so the key is released for a real retry.
      if (c.res.status >= 500) await releaseKey(db, key);
      else if (response) await completeKey(db, key, response as ToolResult<unknown>, c.res.status);
    }
    await finish(c.res.status, response);

    const patientId = patientIdFrom(response?.data);
    if (tool === "verify_patient" && response?.ok && callId && patientId) {
      await db.update(calls).set({ patientId }).where(eq(calls.id, callId));
    }
  });
}

async function verifiedPatient(db: Db, callId: string): Promise<string | null> {
  const [call] = await db
    .select({ patientId: calls.patientId })
    .from(calls)
    .where(eq(calls.id, callId));
  return call?.patientId ?? null;
}

function markReplayed(stored: Recorded): Recorded {
  return stored.ok && stored.data
    ? { ...stored, data: { ...stored.data, replayed: true } }
    : stored;
}

function patientIdFrom(value: unknown): string | null {
  if (value && typeof value === "object" && "patientId" in value) {
    const parsed = Uuid.safeParse((value as { patientId: unknown }).patientId);
    return parsed.success ? parsed.data : null;
  }
  return null;
}
