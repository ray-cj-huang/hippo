import type { Slot } from "@hippo/contracts";
import { appointments, doctorSchedules, doctors, specialties } from "@hippo/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { bookingWindow, SLOT_MINUTES } from "../clinic-time";
import type { Ctx } from "../context";

export type DoctorRow = {
  id: string;
  name: string;
  specialtyId: string;
  specialtyName: string;
  minAge: number | null;
  maxAge: number | null;
  active: boolean;
};

export type OpenSlot = { doctor: DoctorRow; startAt: Date };

export async function loadDoctors(
  ctx: Ctx,
  filter: { specialtyId?: string; doctorId?: string; includeInactive?: boolean } = {},
): Promise<DoctorRow[]> {
  const conditions = [];
  if (filter.specialtyId) conditions.push(eq(doctors.specialtyId, filter.specialtyId));
  if (filter.doctorId) conditions.push(eq(doctors.id, filter.doctorId));
  if (!filter.includeInactive) conditions.push(eq(doctors.active, true));

  const rows = await ctx.db
    .select({
      id: doctors.id,
      title: doctors.title,
      firstName: doctors.firstName,
      lastName: doctors.lastName,
      specialtyId: doctors.specialtyId,
      specialtyName: specialties.name,
      minAge: specialties.minAge,
      maxAge: specialties.maxAge,
      active: doctors.active,
    })
    .from(doctors)
    .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
    .where(and(...conditions))
    .orderBy(doctors.lastName);

  return rows.map(({ title, firstName, lastName, ...rest }) => ({
    ...rest,
    name: `${title} ${firstName} ${lastName}`,
  }));
}

export async function openSlotsOn(
  ctx: Ctx,
  doctorRows: DoctorRow[],
  date: string,
): Promise<OpenSlot[]> {
  if (doctorRows.length === 0) return [];
  const ids = doctorRows.map((d) => d.id);
  const weekday = ctx.time.weekday(date);
  const { start, end } = ctx.time.dayBounds(date);
  const now = ctx.now();

  const [schedules, booked] = await Promise.all([
    ctx.db
      .select()
      .from(doctorSchedules)
      .where(and(inArray(doctorSchedules.doctorId, ids), eq(doctorSchedules.weekday, weekday))),
    ctx.db
      .select({ doctorId: appointments.doctorId, startAt: appointments.startAt })
      .from(appointments)
      .where(
        and(
          inArray(appointments.doctorId, ids),
          eq(appointments.status, "booked"),
          gte(appointments.startAt, start),
          lt(appointments.startAt, end),
        ),
      ),
  ]);

  const taken = new Set(booked.map((b) => `${b.doctorId}|${b.startAt.getTime()}`));
  const byId = new Map(doctorRows.map((d) => [d.id, d]));
  const slots: OpenSlot[] = [];

  for (const schedule of schedules) {
    const doctor = byId.get(schedule.doctorId);
    if (!doctor) continue;
    const windowEnd = ctx.time.instant(date, schedule.endTime).getTime();
    for (
      let t = ctx.time.instant(date, schedule.startTime).getTime();
      t + SLOT_MINUTES * 60_000 <= windowEnd;
      t += SLOT_MINUTES * 60_000
    ) {
      if (t <= now.getTime() || taken.has(`${doctor.id}|${t}`)) continue;
      slots.push({ doctor, startAt: new Date(t) });
    }
  }

  return slots.sort(
    (a, b) =>
      a.startAt.getTime() - b.startAt.getTime() || a.doctor.name.localeCompare(b.doctor.name),
  );
}

export async function isScheduledSlot(
  ctx: Ctx,
  doctor: DoctorRow,
  startAt: Date,
): Promise<boolean> {
  if (!doctor.active) return false;
  const date = ctx.time.localDate(startAt);
  const schedules = await ctx.db
    .select()
    .from(doctorSchedules)
    .where(
      and(
        eq(doctorSchedules.doctorId, doctor.id),
        eq(doctorSchedules.weekday, ctx.time.weekday(date)),
      ),
    );
  const t = startAt.getTime();
  return schedules.some((s) => {
    const from = ctx.time.instant(date, s.startTime).getTime();
    const to = ctx.time.instant(date, s.endTime).getTime();
    return (
      t >= from && t + SLOT_MINUTES * 60_000 <= to && (t - from) % (SLOT_MINUTES * 60_000) === 0
    );
  });
}

export function toSlot(ctx: Ctx, slot: OpenSlot): Slot {
  return {
    slotToken: ctx.tokens.issue({ doctorId: slot.doctor.id, startAt: slot.startAt }, ctx.now()),
    doctorId: slot.doctor.id,
    doctorName: slot.doctor.name,
    specialtyId: slot.doctor.specialtyId,
    startAt: slot.startAt.toISOString(),
    label: ctx.time.label(slot.startAt),
  };
}

export function isInWindow(ctx: Ctx, date: string): boolean {
  const { earliest, latest } = bookingWindow(ctx.time, ctx.now(), ctx.config.bookingWindowDays);
  return date >= earliest && date <= latest;
}

export async function findAlternatives(
  ctx: Ctx,
  near: { doctorId: string; specialtyId: string; startAt: Date },
  limit = 3,
): Promise<Slot[]> {
  const { earliest, latest } = bookingWindow(ctx.time, ctx.now(), ctx.config.bookingWindowDays);
  const specialtyDoctors = await loadDoctors(ctx, { specialtyId: near.specialtyId });
  const requestedDate = ctx.time.localDate(near.startAt);
  // biome-ignore lint/complexity/useMathMinMax: ISO date strings, not numbers
  let date = requestedDate < earliest ? earliest : requestedDate;
  const picked: OpenSlot[] = [];

  while (picked.length < limit && date <= latest) {
    const sameDay = (await openSlotsOn(ctx, specialtyDoctors, date)).filter(
      (s) => !(s.doctor.id === near.doctorId && s.startAt.getTime() === near.startAt.getTime()),
    );
    sameDay.sort((a, b) => {
      const doctorRank =
        Number(a.doctor.id !== near.doctorId) - Number(b.doctor.id !== near.doctorId);
      if (date === requestedDate && doctorRank !== 0) return doctorRank;
      const distance = (s: OpenSlot) => Math.abs(s.startAt.getTime() - near.startAt.getTime());
      return date === requestedDate
        ? distance(a) - distance(b)
        : a.startAt.getTime() - b.startAt.getTime();
    });
    picked.push(...sameDay.slice(0, limit - picked.length));
    date = ctx.time.addDaysToDate(date, 1);
  }

  return picked.map((s) => toSlot(ctx, s));
}
