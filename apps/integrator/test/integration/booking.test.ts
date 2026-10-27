import type { AdminSnapshot } from "@hippo/contracts";
import { appointmentEvents, appointments, integrationCalls } from "@hippo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type ApiResult, createTestApp, SATURDAY, TUESDAY } from "./helpers";

const t = createTestApp();
afterAll(() => t.close());
beforeEach(() => t.reset());

const JOHN_1980 = "00000000-0000-4000-8000-000000001001";
const ALICE = "00000000-0000-4000-8000-000000001003";
const DR_CHEN = "00000000-0000-4000-8000-000000000401";

async function firstSlot(specialty = "orthopedics", date = TUESDAY, doctorId?: string) {
  const res = await t.post("/availability", { specialty, date, doctorId });
  expect(res.body.ok).toBe(true);
  return res.body.data.slots[0] as {
    slotToken: string;
    doctorId: string;
    startAt: string;
    label: string;
  };
}

describe("availability", () => {
  it("returns open slots with spoken labels and tokens", async () => {
    const res = await t.post("/availability", { specialty: "orthopedics", date: TUESDAY });
    expect(res.status).toBe(200);
    expect(res.body.data.slots[0]).toMatchObject({
      label: "Tuesday, November 3rd at 9:00 AM",
      slotToken: expect.any(String),
    });
  });

  it("points to the next open day when a day has no slots", async () => {
    const res = await t.post("/availability", { specialty: "orthopedics", date: SATURDAY });
    expect(res.body.data).toMatchObject({ slots: [], nextAvailable: { date: "2026-11-09" } });
  });

  it("rejects dates outside the booking window", async () => {
    const res = await t.post("/availability", { specialty: "orthopedics", date: "2026-11-02" });
    expect(res.body.error).toMatchObject({ code: "OUTSIDE_BOOKING_WINDOW" });
  });

  it("lists valid options for an unknown specialty", async () => {
    const res = await t.post("/availability", { specialty: "neurology", date: TUESDAY });
    expect(res.body.error?.code).toBe("UNKNOWN_SPECIALTY");
    expect(res.body.error?.details.valid).toContainEqual({
      id: "orthopedics",
      name: "Orthopedics",
    });
  });
});

describe("verify_patient", () => {
  const maria = {
    firstName: "María",
    lastName: "González",
    dob: "1990-03-03",
    callerConfirmed: true,
  };

  it("does not create a record without newPatient", async () => {
    const res = await t.post("/patients/verify", maria);
    expect(res.body.error?.code).toBe("PATIENT_NOT_FOUND");
  });

  it("registers a new patient once and matches them regardless of accents", async () => {
    const created = await t.post("/patients/verify", { ...maria, newPatient: true });
    expect(created.body.data.status).toBe("registered");
    const again = await t.post("/patients/verify", {
      ...maria,
      firstName: "maria",
      lastName: "GONZALEZ",
      newPatient: true,
    });
    expect(again.body.data).toMatchObject({
      status: "verified",
      patientId: created.body.data.patientId,
    });
  });

  it("uses date of birth to tell two John Smiths apart", async () => {
    const res = await t.post("/patients/verify", {
      firstName: "John",
      lastName: "Smith",
      dob: "1992-11-30",
      callerConfirmed: true,
    });
    expect(res.body.data.patientId).toBe("00000000-0000-4000-8000-000000001002");
  });

  it("rejects implausible dates of birth", async () => {
    const res = await t.post("/patients/verify", { ...maria, dob: "2030-01-01" });
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "dob" } });
  });
});

describe("book_appointment", () => {
  it("books, records history and logs the integration call", async () => {
    const slot = await firstSlot();
    const john = await t.caller(JOHN_1980);
    const res = await john.post(
      "/appointments",
      { slotToken: slot.slotToken, reason: "ankle" },
      "tc-1",
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ doctorName: "Dr. Lisa Chen", label: slot.label });

    const events = await t.db
      .select()
      .from(appointmentEvents)
      .where(eq(appointmentEvents.appointmentId, res.body.data.appointmentId));
    expect(events.map((e) => e.type)).toEqual(["booked"]);
    const [logged] = await t.db
      .select()
      .from(integrationCalls)
      .where(eq(integrationCalls.toolCallId, "tc-1"));
    expect(logged).toMatchObject({
      tool: "book_appointment",
      ok: true,
      httpStatus: 201,
      patientId: JOHN_1980,
    });
    expect(events[0]?.integrationCallId).toBe(logged?.id);
  });

  it("lets exactly one of 20 concurrent bookings win and offers alternatives to the rest", async () => {
    const slot = await firstSlot();
    const patients = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        t.post("/patients/verify", {
          firstName: `Racer${i}`,
          lastName: "Test",
          dob: "1985-01-01",
          callerConfirmed: true,
          newPatient: true,
        }),
      ),
    );
    const callers = await Promise.all(patients.map((p) => t.caller(p.body.data.patientId)));
    const results = await Promise.all(
      callers.map((c, i) =>
        c.post("/appointments", { slotToken: slot.slotToken, reason: "race" }, `race-${i}`),
      ),
    );
    const wins = results.filter((r) => r.body.ok);
    const taken = results.filter((r) => r.body.error?.code === "SLOT_TAKEN");
    expect(wins).toHaveLength(1);
    expect(taken).toHaveLength(19);
    expect(taken[0]?.body.error?.message).toContain("No appointment was created.");
    expect(taken[0]?.body.error?.details.alternatives).toHaveLength(3);
    const booked = await t.db.select().from(appointments).where(eq(appointments.status, "booked"));
    expect(booked).toHaveLength(1);
  });

  it("rejects slots that did not come from availability", async () => {
    const john = await t.caller(JOHN_1980);
    const res = await john.post("/appointments", { slotToken: "made.up", reason: "x" });
    expect(res.body.error?.code).toBe("AVAILABILITY_REQUIRED");
  });

  it("rejects expired slot tokens", async () => {
    const slot = await firstSlot();
    t.clock.now = new Date(t.clock.now.getTime() + 31 * 60_000);
    const john = await t.caller(JOHN_1980);
    const res = await john.post("/appointments", { slotToken: slot.slotToken, reason: "x" });
    expect(res.body.error?.code).toBe("AVAILABILITY_EXPIRED");
  });

  it("asks before a second appointment in the same specialty", async () => {
    const [a, b] = (await t.post("/availability", { specialty: "orthopedics", date: TUESDAY })).body
      .data.slots;
    const alice = await t.caller(ALICE);
    await alice.post("/appointments", { slotToken: a.slotToken, reason: "knee" });
    const dup = await alice.post("/appointments", { slotToken: b.slotToken, reason: "knee" });
    expect(dup.body.error).toMatchObject({ code: "DUPLICATE_APPOINTMENT", retryable: true });
    const confirmed = await alice.post("/appointments", {
      slotToken: b.slotToken,
      reason: "knee",
      confirmDuplicate: true,
    });
    expect(confirmed.body.ok).toBe(true);
  });

  it("redirects adults away from pediatrics", async () => {
    const slot = await firstSlot("pediatrics");
    const alice = await t.caller(ALICE);
    const res = await alice.post("/appointments", { slotToken: slot.slotToken, reason: "checkup" });
    expect(res.body.error).toMatchObject({
      code: "AGE_RESTRICTED",
      details: { suggestedSpecialty: "family_medicine" },
    });
  });

  it("replays a retried request instead of booking twice", async () => {
    const slot = await firstSlot();
    const john = await t.caller(JOHN_1980);
    const body = { slotToken: slot.slotToken, reason: "ankle" };
    const first = await john.post("/appointments", body, "retry-1");
    const second = await john.post("/appointments", body, "retry-1");
    expect(second.body.data).toMatchObject({
      appointmentId: first.body.data.appointmentId,
      replayed: true,
    });
    expect(await t.db.select().from(appointments)).toHaveLength(1);
  });
});

describe("cancel and reschedule", () => {
  async function book(specialty = "orthopedics", index = 0) {
    const slots = (await t.post("/availability", { specialty, date: TUESDAY, doctorId: DR_CHEN }))
      .body.data.slots;
    const john = await t.caller(JOHN_1980);
    const res = await john.post<ApiResult>("/appointments", {
      slotToken: slots[index].slotToken,
      reason: "ankle",
    });
    return { appointmentId: res.body.data.appointmentId as string, slots, john };
  }

  it("cancels, frees the slot, and is idempotent", async () => {
    const { appointmentId, slots, john } = await book();
    const res = await john.post(`/appointments/${appointmentId}/cancel`, {});
    expect(res.body.data).toMatchObject({ status: "cancelled", alreadyCancelled: false });
    const again = await john.post(`/appointments/${appointmentId}/cancel`, {});
    expect(again.body.data.alreadyCancelled).toBe(true);
    const freed = await t.post("/availability", {
      specialty: "orthopedics",
      date: TUESDAY,
      doctorId: DR_CHEN,
    });
    expect(freed.body.data.slots[0].startAt).toBe(slots[0].startAt);
  });

  it("hides whether another patient's appointment exists", async () => {
    const { appointmentId } = await book();
    const alice = await t.caller(ALICE);
    const res = await alice.post(`/appointments/${appointmentId}/cancel`, {});
    expect(res.body.error?.code).toBe("NOT_YOUR_APPOINTMENT");
  });

  it("moves an appointment and records both sides of the history", async () => {
    const { appointmentId, slots, john } = await book();
    const res = await john.post(`/appointments/${appointmentId}/reschedule`, {
      slotToken: slots[2].slotToken,
    });
    expect(res.body.data).toMatchObject({
      previousAppointmentId: appointmentId,
      label: slots[2].label,
    });
    const events = await t.db.select().from(appointmentEvents);
    expect(events.map((e) => e.type).sort()).toEqual([
      "booked",
      "rescheduled_in",
      "rescheduled_out",
    ]);
  });

  it("links both sides of a reschedule in the admin snapshot", async () => {
    const { appointmentId, slots, john } = await book();
    const res = await john.post(`/appointments/${appointmentId}/reschedule`, {
      slotToken: slots[2].slotToken,
    });
    const movedId = res.body.data.appointmentId as string;
    const snapshot = await t.call<AdminSnapshot>("GET", "/admin/snapshot");
    const byId = new Map(snapshot.body.appointments.map((a) => [a.id, a]));
    expect(byId.get(appointmentId)).toMatchObject({
      status: "cancelled",
      patientId: JOHN_1980,
      doctorId: DR_CHEN,
      rescheduledTo: movedId,
      rescheduledFrom: null,
    });
    expect(byId.get(movedId)).toMatchObject({
      status: "booked",
      rescheduledTo: null,
      rescheduledFrom: appointmentId,
    });
  });

  it("keeps the original when the new slot was taken", async () => {
    const { appointmentId, slots, john } = await book();
    const alice = await t.caller(ALICE);
    await alice.post("/appointments", { slotToken: slots[3].slotToken, reason: "x" });
    const res = await john.post(`/appointments/${appointmentId}/reschedule`, {
      slotToken: slots[3].slotToken,
    });
    expect(res.body.error?.code).toBe("SLOT_TAKEN");
    expect(res.body.error?.message).toContain("is unchanged");
    const [original] = await t.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId));
    expect(original?.status).toBe("booked");
  });
});
