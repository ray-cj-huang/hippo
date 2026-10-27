import { z } from "zod";
import {
  BookAppointmentArgs,
  GetAvailabilityArgs,
  RescheduleAppointmentArgs,
  VerifyPatientArgs,
} from "./tools";

export const AvailabilityRequest = GetAvailabilityArgs.extend({ patientId: z.uuid().optional() });
export type AvailabilityRequest = z.infer<typeof AvailabilityRequest>;

export const VerifyPatientRequest = VerifyPatientArgs;
export type VerifyPatientRequest = z.infer<typeof VerifyPatientRequest>;

export const BookAppointmentRequest = BookAppointmentArgs.omit({ slotId: true }).extend({
  slotToken: z.string().min(1),
  patientId: z.uuid(),
});
export type BookAppointmentRequest = z.infer<typeof BookAppointmentRequest>;

export const CancelAppointmentRequest = z.object({ patientId: z.uuid() });
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentRequest>;

export const RescheduleAppointmentRequest = RescheduleAppointmentArgs.omit({
  appointmentId: true,
  slotId: true,
}).extend({ slotToken: z.string().min(1), patientId: z.uuid() });
export type RescheduleAppointmentRequest = z.infer<typeof RescheduleAppointmentRequest>;

export const TOOL_CALL_ID_HEADER = "Idempotency-Key";
export const CALL_ID_HEADER = "X-Call-Id";

export const StartCallRequest = z.object({
  id: z.uuid(),
  llmProvider: z.string(),
  llmModel: z.string(),
});

export const EndCallRequest = z.object({ reason: z.string().max(100) });

export const CallEventsRequest = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["user_turn", "agent_turn", "barge_in", "error", "flagged"]),
        at: z.iso.datetime().optional(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .max(100),
});
export type CallEventsRequest = z.infer<typeof CallEventsRequest>;

export const AdminSnapshot = z.object({
  doctors: z.array(
    z.object({ id: z.uuid(), name: z.string(), specialty: z.string(), active: z.boolean() }),
  ),
  patients: z.array(
    z.object({
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string(),
      createdAt: z.string(),
    }),
  ),
  appointments: z.array(
    z.object({
      id: z.uuid(),
      patientName: z.string(),
      doctorName: z.string(),
      specialty: z.string(),
      startAt: z.string(),
      label: z.string(),
      status: z.enum(["booked", "cancelled"]),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminSnapshot = z.infer<typeof AdminSnapshot>;
