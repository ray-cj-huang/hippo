import { describe, expect, it } from "vitest";
import { type Appointment, appointmentsFor, displayStatus, matches } from "../../../lib/database";

const PATIENT = "00000000-0000-4000-8000-000000001001";
const DOCTOR = "00000000-0000-4000-8000-000000000401";

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    patientId: PATIENT,
    patientName: "John Smith",
    doctorId: DOCTOR,
    doctorName: "Dr. Lisa Chen",
    specialty: "Orthopedics",
    startAt: "2026-11-03T17:00:00.000Z",
    label: "Tuesday, November 3 at 9 AM",
    status: "booked",
    reason: null,
    rescheduledTo: null,
    rescheduledFrom: null,
    createdAt: "2026-11-02T16:00:00.000Z",
    ...overrides,
  };
}

describe("displayStatus", () => {
  it("shows a booked appointment as booked, even when it was moved here", () => {
    expect(displayStatus(appointment({}))).toBe("booked");
    expect(displayStatus(appointment({ rescheduledFrom: PATIENT }))).toBe("booked");
  });

  it("tells a reschedule apart from a cancellation", () => {
    expect(displayStatus(appointment({ status: "cancelled" }))).toBe("cancelled");
    expect(displayStatus(appointment({ status: "cancelled", rescheduledTo: PATIENT }))).toBe(
      "rescheduled",
    );
  });
});

describe("matches", () => {
  it("matches any field case-insensitively and ignores surrounding spaces", () => {
    expect(matches("  chen ", ["John Smith", "Dr. Lisa Chen"])).toBe(true);
    expect(matches("derm", ["John Smith", "Orthopedics"])).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matches(" ", ["anything"])).toBe(true);
  });
});

describe("appointmentsFor", () => {
  const early = appointment({ id: "00000000-0000-4000-8000-00000000a002" });
  const late = appointment({
    id: "00000000-0000-4000-8000-00000000a003",
    startAt: "2026-11-05T17:00:00.000Z",
  });
  const other = appointment({
    id: "00000000-0000-4000-8000-00000000a004",
    patientId: "00000000-0000-4000-8000-000000001003",
    doctorId: "00000000-0000-4000-8000-000000000402",
  });

  it("returns one patient's appointments, latest first", () => {
    expect(appointmentsFor([early, other, late], { patientId: PATIENT })).toEqual([late, early]);
  });

  it("returns one doctor's appointments", () => {
    expect(appointmentsFor([early, other], { doctorId: other.doctorId })).toEqual([other]);
  });
});
