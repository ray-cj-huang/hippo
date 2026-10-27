import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { normalizeName } from "./normalize";
import { doctorSchedules, doctors, patients, specialties } from "./schema";
import { seedDoctors, seedPatients, seedSpecialties } from "./seed-data";

export async function resetDatabase(db: Db) {
  await db.execute(sql`
    TRUNCATE appointment_events, idempotency_keys, integration_calls, call_events, appointments, calls, patients,
      doctor_schedules, doctors, specialties RESTART IDENTITY CASCADE
  `);
}

export async function seedClinic(db: Db) {
  await db.insert(specialties).values(seedSpecialties);
  await db.insert(doctors).values(
    seedDoctors.map(({ id, specialtyId, firstName, lastName }) => ({
      id,
      specialtyId,
      firstName,
      lastName,
    })),
  );
  await db
    .insert(doctorSchedules)
    .values(
      seedDoctors.flatMap((d) =>
        d.days.map((weekday) => ({ doctorId: d.id, weekday, startTime: d.start, endTime: d.end })),
      ),
    );
  await db.insert(patients).values(
    seedPatients.map((p) => ({
      ...p,
      firstNameNorm: normalizeName(p.firstName),
      lastNameNorm: normalizeName(p.lastName),
    })),
  );
}

export { seedDoctors, seedPatients, seedSpecialties };
