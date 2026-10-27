import { z } from "zod";
import { AppointmentSummary, IsoDate, Slot, SpecialtyId, SpokenLabel } from "./domain";

export const GetAvailabilityArgs = z.object({
  specialty: SpecialtyId.describe("Specialty id from the clinic directory, e.g. family_medicine."),
  date: IsoDate.describe("Day to check, YYYY-MM-DD in clinic time."),
  doctorId: z
    .uuid()
    .optional()
    .describe("Only when the caller asked for a specific doctor; id from the clinic directory."),
});

export const VerifyPatientArgs = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dob: IsoDate.describe("Date of birth, YYYY-MM-DD."),
  callerConfirmed: z
    .literal(true)
    .describe(
      "True only after you spelled the name back and repeated the DOB and the caller said yes.",
    ),
  newPatient: z
    .boolean()
    .optional()
    .describe(
      "Set true only after a not-found result and the caller confirmed they are a new patient.",
    ),
});

export const BookAppointmentArgs = z.object({
  slotId: z.string().min(1).describe("slotId from a get_availability result, e.g. slot_3."),
  reason: z.string().trim().max(200).describe("Short reason for the visit in the caller's words."),
  confirmDuplicate: z
    .boolean()
    .optional()
    .describe("True only if the caller wants another appointment despite DUPLICATE_APPOINTMENT."),
});

export const ListAppointmentsArgs = z.object({});

export const CancelAppointmentArgs = z.object({
  appointmentId: z.uuid().describe("appointmentId from list_appointments or verify_patient."),
});

export const RescheduleAppointmentArgs = z.object({
  appointmentId: z.uuid().describe("The appointment being moved."),
  slotId: z.string().min(1).describe("slotId for the new time from get_availability."),
});

export const EndCallArgs = z.object({
  reason: z.string().max(100).optional(),
});

export type AvailabilityResult = z.infer<typeof AvailabilityResult>;
export const AvailabilityResult = z.object({
  slots: z.array(Slot),
  nextAvailable: z.object({ date: IsoDate, label: z.string() }).nullable(),
});

export type VerifyPatientResult = z.infer<typeof VerifyPatientResult>;
export const VerifyPatientResult = z.object({
  status: z.enum(["verified", "registered"]),
  patientId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  upcomingAppointments: z.array(AppointmentSummary),
});

export type BookAppointmentResult = z.infer<typeof BookAppointmentResult>;
export const BookAppointmentResult = AppointmentSummary.extend({
  replayed: z.boolean().optional(),
});

export type ListAppointmentsResult = z.infer<typeof ListAppointmentsResult>;
export const ListAppointmentsResult = z.object({ appointments: z.array(AppointmentSummary) });

export type CancelAppointmentResult = z.infer<typeof CancelAppointmentResult>;
export const CancelAppointmentResult = z.object({
  appointmentId: z.uuid(),
  status: z.literal("cancelled"),
  alreadyCancelled: z.boolean(),
  label: SpokenLabel,
});

export type RescheduleAppointmentResult = z.infer<typeof RescheduleAppointmentResult>;
export const RescheduleAppointmentResult = AppointmentSummary.extend({
  previousAppointmentId: z.uuid(),
  previousLabel: SpokenLabel,
});

export const toolDefinitions = {
  get_availability: {
    description:
      "List open 30-minute slots for a specialty (optionally one doctor) on one day. Call before booking or rescheduling; only offer times it returns.",
    args: GetAvailabilityArgs,
  },
  verify_patient: {
    description:
      "Look up the caller by first name, last name and date of birth after they confirmed the spelling. Returns their upcoming appointments. With newPatient true, registers them if not found.",
    args: VerifyPatientArgs,
  },
  book_appointment: {
    description:
      "Book a slot for the verified patient using a slotId from get_availability. Confirm doctor, date and time with the caller first.",
    args: BookAppointmentArgs,
  },
  list_appointments: {
    description: "List the verified patient's upcoming appointments.",
    args: ListAppointmentsArgs,
  },
  cancel_appointment: {
    description:
      "Cancel one of the verified patient's upcoming appointments after the caller confirms.",
    args: CancelAppointmentArgs,
  },
  reschedule_appointment: {
    description:
      "Move one of the verified patient's appointments to a new slot from get_availability. The original is kept if the new slot fails.",
    args: RescheduleAppointmentArgs,
  },
  end_call: {
    description: "Hang up after saying goodbye, or after telling the caller to call 911.",
    args: EndCallArgs,
  },
} as const;

export type ToolName = keyof typeof toolDefinitions;
export const toolNames = Object.keys(toolDefinitions) as ToolName[];
export const ToolNameSchema = z.enum(toolNames as [ToolName, ...ToolName[]]);

export type ToolArgs<N extends ToolName> = z.infer<(typeof toolDefinitions)[N]["args"]>;

export function toolJsonSchema(name: ToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(toolDefinitions[name].args, { target: "draft-7", io: "input" });
  const { $schema: _ignored, ...rest } = schema as Record<string, unknown>;
  return rest;
}
