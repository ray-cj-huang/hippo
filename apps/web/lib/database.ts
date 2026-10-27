import type { AdminSnapshot } from "@hippo/contracts";

export type Appointment = AdminSnapshot["appointments"][number];
export type Patient = AdminSnapshot["patients"][number];
export type Doctor = AdminSnapshot["doctors"][number];
export type Status = "booked" | "cancelled" | "rescheduled";
export type View = { kind: "appointment" | "patient" | "doctor"; id: string };

export function displayStatus(a: Pick<Appointment, "status" | "rescheduledTo">): Status {
  if (a.status === "booked") return "booked";
  return a.rescheduledTo ? "rescheduled" : "cancelled";
}

export function matches(query: string, fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || fields.some((f) => f.toLowerCase().includes(q));
}

export function appointmentsFor(
  appointments: Appointment[],
  by: { patientId: string } | { doctorId: string },
): Appointment[] {
  const list =
    "patientId" in by
      ? appointments.filter((a) => a.patientId === by.patientId)
      : appointments.filter((a) => a.doctorId === by.doctorId);
  return list.sort((a, b) => b.startAt.localeCompare(a.startAt));
}

export function exists(data: AdminSnapshot, view: View): boolean {
  const list =
    view.kind === "appointment"
      ? data.appointments
      : view.kind === "patient"
        ? data.patients
        : data.doctors;
  return list.some((r) => r.id === view.id);
}
