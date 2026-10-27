import {
  type AvailabilityRequest,
  type AvailabilityResult,
  failure,
  success,
  type ToolResult,
  type Warning,
} from "@hippo/contracts";
import { patients, specialties } from "@hippo/db";
import { eq } from "drizzle-orm";
import { bookingWindow } from "../clinic-time";
import type { Ctx } from "../context";
import { ageRestriction } from "./rules";
import { isInWindow, loadDoctors, openSlotsOn, toSlot } from "./slots";

const MAX_SLOTS = 12;

export async function getAvailability(
  ctx: Ctx,
  req: AvailabilityRequest,
  patientId: string | null,
): Promise<ToolResult<AvailabilityResult>> {
  const warnings: Warning[] = [];
  let specialtyId = req.specialty;

  if (req.doctorId) {
    const [doctor] = await loadDoctors(ctx, { doctorId: req.doctorId });
    if (!doctor) {
      const all = await loadDoctors(ctx);
      return failure(
        "UNKNOWN_DOCTOR",
        "No active doctor has that id. Use a doctor id from the clinic directory.",
        {
          details: {
            valid: all.map((d) => ({ id: d.id, name: d.name, specialty: d.specialtyId })),
          },
        },
      );
    }
    if (doctor.specialtyId !== specialtyId) {
      warnings.push({
        code: "DOCTOR_SPECIALTY_MISMATCH",
        message: `${doctor.name} is in ${doctor.specialtyName}, not ${req.specialty}; showing ${doctor.name}'s availability.`,
      });
      specialtyId = doctor.specialtyId;
    }
  }

  const [specialty] = await ctx.db
    .select()
    .from(specialties)
    .where(eq(specialties.id, specialtyId));
  if (!specialty) {
    const all = await ctx.db
      .select({ id: specialties.id, name: specialties.name })
      .from(specialties);
    return failure("UNKNOWN_SPECIALTY", `"${specialtyId}" is not a specialty at this clinic.`, {
      details: { valid: all },
    });
  }

  const window = bookingWindow(ctx.time, ctx.now(), ctx.config.bookingWindowDays);
  if (!isInWindow(ctx, req.date)) {
    return failure(
      "OUTSIDE_BOOKING_WINDOW",
      `Appointments can be booked from ${ctx.time.dateLabel(window.earliest)} through ${ctx.time.dateLabel(window.latest)}. No availability was checked for ${req.date}.`,
      { details: { earliest: window.earliest, latest: window.latest } },
    );
  }

  if (patientId) {
    const [patient] = await ctx.db.select().from(patients).where(eq(patients.id, patientId));
    const restriction =
      patient && ageRestriction(ctx, specialty, patient.dob, ctx.time.instant(req.date, "12:00"));
    if (restriction) warnings.push({ code: "AGE_RESTRICTED", message: restriction.message });
  }

  const doctorRows = await loadDoctors(
    ctx,
    req.doctorId ? { doctorId: req.doctorId } : { specialtyId },
  );
  const open = await openSlotsOn(ctx, doctorRows, req.date);
  const who = req.doctorId ? doctorRows[0]?.name : specialty.name;

  if (open.length > 0) {
    const slots = open.slice(0, MAX_SLOTS).map((s) => toSlot(ctx, s));
    return success(
      { slots, nextAvailable: null },
      `${open.length} open slot${open.length === 1 ? "" : "s"} for ${who} on ${ctx.time.dateLabel(req.date)}${open.length > MAX_SLOTS ? `; showing the first ${MAX_SLOTS}` : ""}. Nothing is reserved until booked.`,
      warnings,
    );
  }

  for (
    let date = ctx.time.addDaysToDate(req.date, 1);
    date <= window.latest;
    date = ctx.time.addDaysToDate(date, 1)
  ) {
    if ((await openSlotsOn(ctx, doctorRows, date)).length > 0) {
      const label = ctx.time.dateLabel(date);
      return success(
        { slots: [], nextAvailable: { date, label } },
        `${who} has no openings on ${ctx.time.dateLabel(req.date)}. The next day with openings is ${label}; call get_availability for that date to get bookable slots.`,
        warnings,
      );
    }
  }

  return success(
    { slots: [], nextAvailable: null },
    `${who} has no openings on ${ctx.time.dateLabel(req.date)} or any later day in the booking window.`,
    warnings,
  );
}
