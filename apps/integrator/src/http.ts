import { type ErrorCode, failure, type ToolResult } from "@hippo/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

const statusByCode: Record<ErrorCode, ContentfulStatusCode> = {
  VALIDATION_ERROR: 400,
  PATIENT_NOT_FOUND: 404,
  NOT_YOUR_APPOINTMENT: 404,
  UNKNOWN_SPECIALTY: 404,
  UNKNOWN_DOCTOR: 404,
  SLOT_TAKEN: 409,
  PATIENT_TIME_CONFLICT: 409,
  DUPLICATE_APPOINTMENT: 409,
  NO_CHANGE: 409,
  SLOT_UNAVAILABLE: 409,
  SLOT_IN_PAST: 422,
  AVAILABILITY_REQUIRED: 422,
  AVAILABILITY_EXPIRED: 422,
  OUTSIDE_BOOKING_WINDOW: 422,
  AGE_RESTRICTED: 422,
  APPOINTMENT_IN_PAST: 422,
  APPOINTMENT_NOT_ACTIVE: 422,
  PATIENT_NOT_IDENTIFIED: 403,
  SERVICE_UNAVAILABLE: 503,
  OUTCOME_UNKNOWN: 500,
  INTERNAL_ERROR: 500,
};

export function statusFor(result: ToolResult<unknown>, okStatus: ContentfulStatusCode = 200) {
  return result.ok ? okStatus : statusByCode[result.error.code];
}

export function respond(
  c: Context,
  result: ToolResult<unknown>,
  okStatus: ContentfulStatusCode = 200,
) {
  return c.json(result, statusFor(result, okStatus));
}

export async function parseJson<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; result: ToolResult<never> }> {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "body";
  return {
    ok: false,
    result: failure(
      "VALIDATION_ERROR",
      `Invalid ${field}: ${issue?.message ?? "malformed request"}.`,
      {
        details: { field },
      },
    ),
  };
}
