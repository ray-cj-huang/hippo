import type { Clinic } from "@hippo/contracts";
import { doctorSchedules, specialties } from "@hippo/db";
import { inArray } from "drizzle-orm";
import { bookingWindow } from "../clinic-time";
import type { Ctx } from "../context";
import { loadDoctors } from "./slots";

export async function getClinic(ctx: Ctx): Promise<Clinic> {
  const [specialtyRows, doctorRows] = await Promise.all([
    ctx.db.select().from(specialties).orderBy(specialties.name),
    loadDoctors(ctx),
  ]);
  const schedules = doctorRows.length
    ? await ctx.db
        .select()
        .from(doctorSchedules)
        .where(
          inArray(
            doctorSchedules.doctorId,
            doctorRows.map((d) => d.id),
          ),
        )
    : [];
  const window = bookingWindow(ctx.time, ctx.now(), ctx.config.bookingWindowDays);

  return {
    name: ctx.config.clinicName,
    timezone: ctx.config.timezone,
    today: window.today,
    bookingWindow: { earliest: window.earliest, latest: window.latest },
    specialties: specialtyRows.map((s) => ({
      id: s.id,
      name: s.name,
      isPrimaryCare: s.isPrimaryCare,
      minAge: s.minAge,
      maxAge: s.maxAge,
    })),
    doctors: doctorRows.map((d) => ({
      id: d.id,
      name: d.name,
      specialtyId: d.specialtyId,
      hours: schedules
        .filter((s) => s.doctorId === d.id)
        .sort((a, b) => a.weekday - b.weekday)
        .map((s) => ({
          weekday: s.weekday,
          start: s.startTime.slice(0, 5),
          end: s.endTime.slice(0, 5),
        })),
    })),
  };
}
