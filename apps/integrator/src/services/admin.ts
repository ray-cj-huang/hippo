import type { AdminSnapshot } from "@hippo/contracts";
import { appointments, doctors, patients, specialties } from "@hippo/db";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Ctx } from "../context";

const LIMIT = 100;

export async function adminSnapshot(ctx: Ctx): Promise<AdminSnapshot> {
  const previous = alias(appointments, "previous");
  const [doctorRows, patientRows, appointmentRows] = await Promise.all([
    ctx.db
      .select({
        id: doctors.id,
        title: doctors.title,
        firstName: doctors.firstName,
        lastName: doctors.lastName,
        specialty: specialties.name,
        active: doctors.active,
      })
      .from(doctors)
      .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
      .orderBy(specialties.name, doctors.lastName),
    ctx.db.select().from(patients).orderBy(desc(patients.createdAt)).limit(LIMIT),
    ctx.db
      .select({
        id: appointments.id,
        patientId: appointments.patientId,
        doctorId: appointments.doctorId,
        patientFirst: patients.firstName,
        patientLast: patients.lastName,
        title: doctors.title,
        doctorFirst: doctors.firstName,
        doctorLast: doctors.lastName,
        specialty: specialties.name,
        startAt: appointments.startAt,
        status: appointments.status,
        reason: appointments.reason,
        rescheduledTo: appointments.rescheduledTo,
        rescheduledFrom: previous.id,
        createdAt: appointments.createdAt,
      })
      .from(appointments)
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .innerJoin(specialties, eq(specialties.id, doctors.specialtyId))
      .leftJoin(previous, eq(previous.rescheduledTo, appointments.id))
      .orderBy(desc(appointments.updatedAt))
      .limit(LIMIT),
  ]);

  return {
    doctors: doctorRows.map((d) => ({
      id: d.id,
      name: `${d.title} ${d.firstName} ${d.lastName}`,
      specialty: d.specialty,
      active: d.active,
    })),
    patients: patientRows.map((p) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      dob: p.dob,
      createdAt: p.createdAt.toISOString(),
    })),
    appointments: appointmentRows.map((a) => ({
      id: a.id,
      patientId: a.patientId,
      patientName: `${a.patientFirst} ${a.patientLast}`,
      doctorId: a.doctorId,
      doctorName: `${a.title} ${a.doctorFirst} ${a.doctorLast}`,
      specialty: a.specialty,
      startAt: a.startAt.toISOString(),
      label: ctx.time.label(a.startAt),
      status: a.status,
      reason: a.reason,
      rescheduledTo: a.rescheduledTo,
      rescheduledFrom: a.rescheduledFrom,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}
