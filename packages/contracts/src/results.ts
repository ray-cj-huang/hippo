import { z } from "zod";

export const errorCodes = [
  "SLOT_TAKEN",
  "SLOT_UNAVAILABLE",
  "SLOT_IN_PAST",
  "AVAILABILITY_REQUIRED",
  "AVAILABILITY_EXPIRED",
  "OUTSIDE_BOOKING_WINDOW",
  "PATIENT_NOT_IDENTIFIED",
  "PATIENT_NOT_FOUND",
  "PATIENT_TIME_CONFLICT",
  "DUPLICATE_APPOINTMENT",
  "AGE_RESTRICTED",
  "NOT_YOUR_APPOINTMENT",
  "APPOINTMENT_IN_PAST",
  "APPOINTMENT_NOT_ACTIVE",
  "NO_CHANGE",
  "UNKNOWN_SPECIALTY",
  "UNKNOWN_DOCTOR",
  "VALIDATION_ERROR",
  "SERVICE_UNAVAILABLE",
  "OUTCOME_UNKNOWN",
  "INTERNAL_ERROR",
] as const;

export const ErrorCode = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const WarningCode = z.enum([
  "DOCTOR_SPECIALTY_MISMATCH",
  "AGE_RESTRICTED",
  "LATE_CANCELLATION",
  "SPECIALTY_CHANGED",
]);
export type WarningCode = z.infer<typeof WarningCode>;

export const Warning = z.object({ code: WarningCode, message: z.string() });
export type Warning = z.infer<typeof Warning>;

export const ToolError = z.object({
  code: ErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolError = z.infer<typeof ToolError>;

export type ToolResult<T> =
  | { ok: true; data: T; message: string; warnings?: Warning[] }
  | { ok: false; error: ToolError };

export function toolResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      data,
      message: z.string(),
      warnings: z.array(Warning).optional(),
    }),
    z.object({ ok: z.literal(false), error: ToolError }),
  ]);
}

export function success<T>(data: T, message: string, warnings?: Warning[]): ToolResult<T> {
  return warnings?.length ? { ok: true, data, message, warnings } : { ok: true, data, message };
}

export function failure(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; details?: Record<string, unknown> } = {},
): ToolResult<never> {
  const error: ToolError = { code, message, retryable: options.retryable ?? false };
  if (options.details) error.details = options.details;
  return { ok: false, error };
}
