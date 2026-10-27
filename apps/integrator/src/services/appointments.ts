import {
  type AppointmentSummary,
  type BookAppointmentRequest,
  type BookAppointmentResult,
  type CancelAppointmentResult,
  failure,
  type ListAppointmentsResult,
  type RescheduleAppointmentRequest,
  type RescheduleAppointmentResult,
  type Result,
  success,
  type ToolError,
  type ToolResult,
  type Warning,
} from "@hippo/contracts";
import { appointmentEvents, appointments, doctors, patients, specialties } from "@hippo/db";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Ctx } from "../context";
import { completeKey, type KeyRef } from "../idempotency";
import type { SlotRef } from "../slot-token";
import { ageRestriction } from "./rules";
import { type DoctorRow, findAlternatives, isScheduledSlot, loadDoctors } from "./slots";

type Booked = BookAppointmentResult;
type Cancelled = CancelAppointmentResult;
type Rescheduled = RescheduleAppointmentResult;
type Listed = ListAppointmentsResult;

const LATE_CANCELLATION_MS = 24 * 60 * 60 * 1000;

export type ActionMeta = {
  integrationCallId: string | null;
  callId: string | null;
  key: KeyRef | null;
};

function eventFields(meta: ActionMeta) {
  return { integrationCallId: meta.integrationCallId, callId: meta.callId };
}

export async function upcomingAppointments(
  ctx: Ctx,
  patientId: string,
): Promise<AppointmentSummary[]> {
  const rows = await ctx.db
    .select({
      appointmentId: appointments.id,
      doctorId: doctors.id,
      title: doctors.title,
      firstName: doctors.firstName,
      lastName: doctors.lastName,
      specialtyId: specialties.id,
      specialtyName: specialties.name,
      startAt: appointments.startAt,
    })
    .from(appointments)
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
    .where(
      and(
        eq(appointments.patientId, patientId),
        eq(appointments.status, "booked"),
        gt(appointments.startAt, ctx.now()),
      ),
    )
    .orderBy(asc(appointments.startAt));

  return rows.map((r) => ({
    appointmentId: r.appointmentId,
    doctorId: r.doctorId,
    doctorName: `${r.title} ${r.firstName} ${r.lastName}`,
    specialtyId: r.specialtyId,
    specialtyName: r.specialtyName,
    startAt: r.startAt.toISOString(),
    label: ctx.time.label(r.startAt),
  }));
}

export async function listAppointments(ctx: Ctx, patientId: string): Promise<ToolResult<Listed>> {
  const list = await upcomingAppointments(ctx, patientId);
  return success(
    { appointments: list },
    list.length === 0
      ? "The patient has no upcoming appointments."
      : `The patient has ${list.length} upcoming appointment${list.length === 1 ? "" : "s"}.`,
  );
}

async function checkSlot(
  ctx: Ctx,
  slotToken: string,
  unchanged: string,
): Promise<Result<{ doctor: DoctorRow; slot: SlotRef }, ToolError>> {
  const verified = ctx.tokens.verify(slotToken, ctx.now());
  if (!verified.ok) {
    return verified.error === "expired"
      ? failure(
          "AVAILABILITY_EXPIRED",
          `This slot was offered more than ${Math.round(ctx.config.slotTokenTtlSeconds / 60)} minutes ago. ${unchanged} Call get_availability again.`,
        )
      : failure(
          "AVAILABILITY_REQUIRED",
          `This time did not come from an availability check. ${unchanged} Call get_availability and use a slotToken it returns.`,
        );
  }

  const slot = verified.data;
  if (slot.startAt.getTime() <= ctx.now().getTime()) {
    return failure(
      "SLOT_IN_PAST",
      `${ctx.time.label(slot.startAt)} has already passed. ${unchanged}`,
    );
  }

  const [doctor] = await loadDoctors(ctx, { doctorId: slot.doctorId, includeInactive: true });
  if (!doctor || !(await isScheduledSlot(ctx, doctor, slot.startAt))) {
    const alternatives = doctor
      ? await findAlternatives(ctx, {
          doctorId: doctor.id,
          specialtyId: doctor.specialtyId,
          startAt: slot.startAt,
        })
      : [];
    return failure(
      "SLOT_UNAVAILABLE",
      `${ctx.time.label(slot.startAt)} is no longer on the doctor's schedule. ${unchanged}`,
      { details: { alternatives } },
    );
  }
  return { ok: true, data: { doctor, slot } };
}

async function loadPatient(ctx: Ctx, patientId: string) {
  return (await ctx.db.select().from(patients).where(eq(patients.id, patientId)))[0];
}

async function patientBookingAt(ctx: Ctx, patientId: string, startAt: Date) {
  return (await upcomingAppointments(ctx, patientId)).find(
    (a) => new Date(a.startAt).getTime() === startAt.getTime(),
  );
}

async function conflictResult(
  ctx: Ctx,
  patientId: string,
  doctor: DoctorRow,
  startAt: Date,
  unchanged: string,
): Promise<ToolResult<never>> {
  const own = await patientBookingAt(ctx, patientId, startAt);
  if (own) {
    const what =
      own.doctorId === doctor.id
        ? "this exact appointment"
        : `an appointment with ${own.doctorName}`;
    return failure(
      "PATIENT_TIME_CONFLICT",
      `The patient already has ${what} at ${own.label}. ${unchanged}`,
      {
        details: { existing: own },
      },
    );
  }
  const alternatives = await findAlternatives(ctx, {
    doctorId: doctor.id,
    specialtyId: doctor.specialtyId,
    startAt,
  });
  return failure(
    "SLOT_TAKEN",
    `${doctor.name}'s ${ctx.time.label(startAt)} slot was booked by another patient moments ago. ${unchanged}`,
    { details: { alternatives } },
  );
}

function summary(
  ctx: Ctx,
  appointmentId: string,
  doctor: DoctorRow,
  startAt: Date,
): AppointmentSummary {
  return {
    appointmentId,
    doctorId: doctor.id,
    doctorName: doctor.name,
    specialtyId: doctor.specialtyId,
    specialtyName: doctor.specialtyName,
    startAt: startAt.toISOString(),
    label: ctx.time.label(startAt),
  };
}

export async function bookAppointment(
  ctx: Ctx,
  patientId: string,
  req: BookAppointmentRequest,
  meta: ActionMeta,
): Promise<ToolResult<Booked>> {
  const unchanged = "No appointment was created.";
  const check = await checkSlot(ctx, req.slotToken, unchanged);
  if (!check.ok) return check;
  const { doctor, slot } = check.data;

  const patient = await loadPatient(ctx, patientId);
  if (!patient)
    return failure(
      "PATIENT_NOT_FOUND",
      `The verified patient record no longer exists. ${unchanged}`,
    );

  const restriction = ageRestriction(
    ctx,
    { ...doctor, id: doctor.specialtyId, name: doctor.specialtyName },
    patient.dob,
    slot.startAt,
  );
  if (restriction) {
    return failure("AGE_RESTRICTED", `${restriction.message} ${unchanged}`, {
      details: { suggestedSpecialty: restriction.suggestedSpecialty },
    });
  }

  if (!req.confirmDuplicate) {
    const existing = (await upcomingAppointments(ctx, patient.id)).find(
      (a) => a.specialtyId === doctor.specialtyId,
    );
    if (existing) {
      return failure(
        "DUPLICATE_APPOINTMENT",
        `The patient already has a ${existing.specialtyName} appointment with ${existing.doctorName} on ${existing.label}. ${unchanged} Ask whether they want to keep it, reschedule it, or book an additional one (confirmDuplicate: true).`,
        { retryable: true, details: { existing } },
      );
    }
  }

  // No conflict target, so a hit on either unique index returns no row.
  const result = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        patientId: patient.id,
        doctorId: doctor.id,
        startAt: slot.startAt,
        reason: req.reason.trim().slice(0, 200) || null,
      })
      .onConflictDoNothing()
      .returning({ id: appointments.id });
    if (!row) return null;
    await tx
      .insert(appointmentEvents)
      .values({ appointmentId: row.id, type: "booked", ...eventFields(meta) });
    const booked = summary(ctx, row.id, doctor, slot.startAt);
    const ok = success(
      booked,
      `Booked ${doctor.name} (${doctor.specialtyName}) on ${booked.label}.`,
    );
    if (meta.key) await completeKey(tx, meta.key, ok, 201);
    return ok;
  });

  return result ?? conflictResult(ctx, patient.id, doctor, slot.startAt, unchanged);
}

export async function cancelAppointment(
  ctx: Ctx,
  appointmentId: string,
  patientId: string,
  meta: ActionMeta,
): Promise<ToolResult<Cancelled>> {
  const [appt] = await ctx.db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId)));
  if (!appt) {
    return failure(
      "NOT_YOUR_APPOINTMENT",
      "No appointment with that id belongs to this patient. Nothing was cancelled.",
    );
  }

  const label = ctx.time.label(appt.startAt);
  if (appt.status === "cancelled") {
    return success(
      { appointmentId, status: "cancelled", alreadyCancelled: true, label },
      `The appointment on ${label} was already cancelled. Nothing changed.`,
    );
  }
  const now = ctx.now();
  if (appt.startAt.getTime() <= now.getTime()) {
    return failure(
      "APPOINTMENT_IN_PAST",
      `The appointment on ${label} is in the past and can't be cancelled.`,
    );
  }

  const warnings: Warning[] =
    appt.startAt.getTime() - now.getTime() < LATE_CANCELLATION_MS
      ? [{ code: "LATE_CANCELLATION", message: "The appointment was less than 24 hours away." }]
      : [];
  const result = success(
    { appointmentId, status: "cancelled" as const, alreadyCancelled: false, label },
    `Cancelled the appointment on ${label}. The slot is now free.`,
    warnings,
  );

  await ctx.db.transaction(async (tx) => {
    const changed = await tx
      .update(appointments)
      .set({ status: "cancelled" })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.status, "booked")))
      .returning({ id: appointments.id });
    if (changed.length > 0) {
      await tx
        .insert(appointmentEvents)
        .values({ appointmentId, type: "cancelled", ...eventFields(meta) });
    }
    if (meta.key) await completeKey(tx, meta.key, result, 200);
  });
  return result;
}

class Rollback extends Error {}

export async function rescheduleAppointment(
  ctx: Ctx,
  appointmentId: string,
  patientId: string,
  req: RescheduleAppointmentRequest,
  meta: ActionMeta,
): Promise<ToolResult<Rescheduled>> {
  const [original] = await ctx.db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, patientId)));
  if (!original) {
    return failure(
      "NOT_YOUR_APPOINTMENT",
      "No appointment with that id belongs to this patient. Nothing was changed.",
    );
  }
  const previousLabel = ctx.time.label(original.startAt);
  if (original.status !== "booked" || original.startAt.getTime() <= ctx.now().getTime()) {
    return failure(
      "APPOINTMENT_NOT_ACTIVE",
      `The appointment on ${previousLabel} is ${original.status === "booked" ? "in the past" : "already cancelled"}, so it can't be rescheduled. Book a new appointment instead.`,
    );
  }

  const unchanged = `The original appointment on ${previousLabel} is unchanged.`;
  const check = await checkSlot(ctx, req.slotToken, unchanged);
  if (!check.ok) return check;
  const { doctor, slot } = check.data;

  if (doctor.id === original.doctorId && slot.startAt.getTime() === original.startAt.getTime()) {
    return failure(
      "NO_CHANGE",
      `The new time is the same as the current appointment. ${unchanged}`,
    );
  }

  const patient = await loadPatient(ctx, patientId);
  if (!patient)
    return failure(
      "PATIENT_NOT_FOUND",
      `The verified patient record no longer exists. ${unchanged}`,
    );
  const restriction = ageRestriction(
    ctx,
    { ...doctor, id: doctor.specialtyId, name: doctor.specialtyName },
    patient.dob,
    slot.startAt,
  );
  if (restriction) {
    return failure("AGE_RESTRICTED", `${restriction.message} ${unchanged}`, {
      details: { suggestedSpecialty: restriction.suggestedSpecialty },
    });
  }

  const [originalDoctor] = await loadDoctors(ctx, {
    doctorId: original.doctorId,
    includeInactive: true,
  });
  const warnings: Warning[] =
    originalDoctor && originalDoctor.specialtyId !== doctor.specialtyId
      ? [
          {
            code: "SPECIALTY_CHANGED",
            message: `Moved from ${originalDoctor.specialtyName} to ${doctor.specialtyName}.`,
          },
        ]
      : [];

  // Cancel first so moving to the same time with another doctor doesn't hit the patient's own booking.
  try {
    return await ctx.db.transaction(async (tx) => {
      const cancelled = await tx
        .update(appointments)
        .set({ status: "cancelled" })
        .where(and(eq(appointments.id, original.id), eq(appointments.status, "booked")))
        .returning({ id: appointments.id });
      if (cancelled.length === 0) throw new Rollback("original not active");

      const [inserted] = await tx
        .insert(appointments)
        .values({
          patientId,
          doctorId: doctor.id,
          startAt: slot.startAt,
          reason: original.reason,
        })
        .onConflictDoNothing()
        .returning({ id: appointments.id });
      if (!inserted) throw new Rollback("slot conflict");

      await tx
        .update(appointments)
        .set({ rescheduledTo: inserted.id })
        .where(eq(appointments.id, original.id));
      await tx.insert(appointmentEvents).values([
        {
          appointmentId: original.id,
          type: "rescheduled_out",
          details: { to: inserted.id },
          ...eventFields(meta),
        },
        {
          appointmentId: inserted.id,
          type: "rescheduled_in",
          details: { from: original.id },
          ...eventFields(meta),
        },
      ]);
      const moved = summary(ctx, inserted.id, doctor, slot.startAt);
      const result = success(
        { ...moved, previousAppointmentId: original.id, previousLabel },
        `Moved the appointment from ${previousLabel} to ${moved.label} with ${doctor.name}. The old slot is now free.`,
        warnings,
      );
      if (meta.key) await completeKey(tx, meta.key, result, 200);
      return result;
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    if (error.message === "original not active") {
      return failure(
        "APPOINTMENT_NOT_ACTIVE",
        `The appointment on ${previousLabel} was cancelled in the meantime. Nothing was changed.`,
      );
    }
    return conflictResult(ctx, patientId, doctor, slot.startAt, unchanged);
  }
}
