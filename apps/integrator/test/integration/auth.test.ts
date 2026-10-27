import { CALL_ID_HEADER } from "@hippo/contracts";
import { appointments, calls } from "@hippo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AUTH, CALL_A, createTestApp, TUESDAY } from "./helpers";

const t = createTestApp();
afterAll(() => t.close());
beforeEach(() => t.reset());

const JOHN_1980 = "00000000-0000-4000-8000-000000001001";
const ALICE = "00000000-0000-4000-8000-000000001003";

async function firstSlotToken() {
  const res = await t.post("/availability", { specialty: "orthopedics", date: TUESDAY });
  return res.body.data.slots[0].slotToken as string;
}

describe("service token", () => {
  it("rejects requests without the token", async () => {
    const res = await t.app.request("/availability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specialty: "orthopedics", date: TUESDAY }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
  });

  it("rejects a wrong token without touching the database", async () => {
    const res = await t.call(
      "POST",
      "/appointments",
      { slotToken: "x", reason: "x" },
      { authorization: "Bearer wrong", [CALL_ID_HEADER]: CALL_A },
    );
    expect(res.status).toBe(401);
    expect(await t.db.select().from(calls)).toHaveLength(0);
  });

  it("keeps /health and /admin/snapshot public", async () => {
    expect((await t.app.request("/health")).status).toBe(200);
    expect((await t.app.request("/admin/snapshot")).status).toBe(200);
  });

  it("does not serve /admin/snapshot unless enabled", async () => {
    const locked = createTestApp({ adminEnabled: false });
    try {
      expect((await locked.app.request("/admin/snapshot", { headers: AUTH })).status).toBe(404);
    } finally {
      await locked.close();
    }
  });
});

describe("patient bound to the call", () => {
  it("refuses appointment tools on a call with no verified patient", async () => {
    const slotToken = await firstSlotToken();
    const headers = { [CALL_ID_HEADER]: CALL_A };
    const book = await t.call("POST", "/appointments", { slotToken, reason: "x" }, headers);
    const list = await t.call("GET", "/appointments", undefined, headers);
    expect(book.status).toBe(403);
    expect(book.body).toMatchObject({ error: { code: "PATIENT_NOT_IDENTIFIED" } });
    expect(list.body).toMatchObject({ error: { code: "PATIENT_NOT_IDENTIFIED" } });
    expect(await t.db.select().from(appointments)).toHaveLength(0);
  });

  it("refuses appointment tools without a call id", async () => {
    const res = await t.call("GET", "/appointments");
    expect(res.body).toMatchObject({ error: { code: "PATIENT_NOT_IDENTIFIED" } });
  });

  it("ignores a patientId in the body", async () => {
    const john = await t.caller(JOHN_1980);
    const alice = await t.caller(ALICE);
    const booked = await john.post("/appointments", {
      slotToken: await firstSlotToken(),
      reason: "x",
    });
    const res = await alice.post(`/appointments/${booked.body.data.appointmentId}/cancel`, {
      patientId: JOHN_1980,
    });
    expect(res.body.error?.code).toBe("NOT_YOUR_APPOINTMENT");
    const [appt] = await t.db
      .select()
      .from(appointments)
      .where(eq(appointments.id, booked.body.data.appointmentId));
    expect(appt?.status).toBe("booked");
  });

  it("binds the call to the patient verify_patient found", async () => {
    const verified = await t.post(
      "/patients/verify",
      { firstName: "John", lastName: "Smith", dob: "1980-05-12", callerConfirmed: true },
      "tc-verify",
      CALL_A,
    );
    expect(verified.body.data.patientId).toBe(JOHN_1980);
    const res = await t.call("GET", "/appointments", undefined, { [CALL_ID_HEADER]: CALL_A });
    expect(res.body).toMatchObject({ ok: true });
  });
});
