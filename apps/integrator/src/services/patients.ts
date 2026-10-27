import {
  failure,
  success,
  type ToolResult,
  type VerifyPatientRequest,
  type VerifyPatientResult,
} from "@hippo/contracts";
import { normalizeName, patients } from "@hippo/db";
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../context";
import { upcomingAppointments } from "./appointments";
import { isPlausibleDob } from "./rules";

type Result = VerifyPatientResult;

export async function verifyPatient(
  ctx: Ctx,
  req: VerifyPatientRequest,
): Promise<ToolResult<Result>> {
  if (!isPlausibleDob(ctx, req.dob)) {
    return failure(
      "VALIDATION_ERROR",
      `Date of birth ${req.dob} is not plausible. Confirm it with the caller.`,
      {
        details: { field: "dob" },
      },
    );
  }

  const firstNameNorm = normalizeName(req.firstName);
  const lastNameNorm = normalizeName(req.lastName);
  if (!firstNameNorm || !lastNameNorm) {
    return failure("VALIDATION_ERROR", "First and last name are both required.", {
      details: { field: firstNameNorm ? "lastName" : "firstName" },
    });
  }

  const findExisting = async () =>
    (
      await ctx.db
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.firstNameNorm, firstNameNorm),
            eq(patients.lastNameNorm, lastNameNorm),
            eq(patients.dob, req.dob),
          ),
        )
    )[0];

  const existing = await findExisting();
  if (existing) {
    const upcoming = await upcomingAppointments(ctx, existing.id);
    const already = req.newPatient
      ? " They were already registered, so no new record was created."
      : "";
    return success(
      {
        status: "verified",
        patientId: existing.id,
        firstName: existing.firstName,
        lastName: existing.lastName,
        upcomingAppointments: upcoming,
      },
      `Verified ${existing.firstName} ${existing.lastName}.${already} ${describeUpcoming(upcoming.length)}`,
    );
  }

  if (!req.newPatient) {
    return failure(
      "PATIENT_NOT_FOUND",
      "No patient matches that name and date of birth. No record was created. Re-confirm the spelling once, then ask whether they are a new patient.",
    );
  }

  // Losing a concurrent registration of the same person still counts as verified.
  const [created] = await ctx.db
    .insert(patients)
    .values({
      firstName: req.firstName,
      lastName: req.lastName,
      firstNameNorm,
      lastNameNorm,
      dob: req.dob,
    })
    .onConflictDoNothing({ target: [patients.lastNameNorm, patients.firstNameNorm, patients.dob] })
    .returning();
  const patient = created ?? (await findExisting());
  if (!patient)
    return failure("INTERNAL_ERROR", "Registration failed. No record was created.", {
      retryable: true,
    });

  return success(
    {
      status: created ? "registered" : "verified",
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      upcomingAppointments: [],
    },
    `Registered ${patient.firstName} ${patient.lastName} as a new patient. They have no appointments yet.`,
  );
}

function describeUpcoming(count: number): string {
  if (count === 0) return "They have no upcoming appointments.";
  return `They have ${count} upcoming appointment${count === 1 ? "" : "s"} (listed in upcomingAppointments).`;
}
