import { z } from "zod";

export const IsoDate = z.iso.date();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const SpecialtyId = z.string().regex(/^[a-z][a-z_]*$/, "specialty id is a snake_case slug");

export const SpokenLabel = z.string();

export const Slot = z.object({
  slotToken: z.string(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  specialtyId: SpecialtyId,
  startAt: IsoDateTime,
  label: SpokenLabel,
});
export type Slot = z.infer<typeof Slot>;

export const AppointmentSummary = z.object({
  appointmentId: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  specialtyId: SpecialtyId,
  specialtyName: z.string(),
  startAt: IsoDateTime,
  label: SpokenLabel,
});
export type AppointmentSummary = z.infer<typeof AppointmentSummary>;

export const Doctor = z.object({
  id: z.uuid(),
  name: z.string(),
  specialtyId: SpecialtyId,
  hours: z.array(
    z.object({ weekday: z.number().int().min(0).max(6), start: z.string(), end: z.string() }),
  ),
});

export const Specialty = z.object({
  id: SpecialtyId,
  name: z.string(),
  isPrimaryCare: z.boolean(),
  minAge: z.number().int().nullable(),
  maxAge: z.number().int().nullable(),
});

export const Clinic = z.object({
  name: z.string(),
  timezone: z.string(),
  today: IsoDate,
  bookingWindow: z.object({ earliest: IsoDate, latest: IsoDate }),
  specialties: z.array(Specialty),
  doctors: z.array(Doctor),
});
export type Clinic = z.infer<typeof Clinic>;
