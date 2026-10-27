import { appointmentEvents, appointments, idempotencyKeys, integrationCalls } from "@hippo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CALL_A, CALL_B, createTestApp, TUESDAY } from "./helpers";

const t = createTestApp();
afterAll(() => t.close());
beforeEach(() => t.reset());

const JOHN_1980 = "00000000-0000-4000-8000-000000001001";
const ALICE = "00000000-0000-4000-8000-000000001003";

async function slots() {
  return (await t.post("/availability", { specialty: "orthopedics", date: TUESDAY })).body.data
    .slots as { slotToken: string }[];
}

describe("idempotency keys", () => {
  it("replays a retry within the same call", async () => {
    const [slot] = await slots();
    const body = { patientId: JOHN_1980, slotToken: slot?.slotToken, reason: "ankle" };
    const first = await t.post("/appointments", body, "tc-1");
    const retry = await t.post("/appointments", body, "tc-1");
    expect(retry.status).toBe(201);
    expect(retry.body.data).toMatchObject({
      appointmentId: first.body.data.appointmentId,
      replayed: true,
    });
    expect(await t.db.select().from(appointments)).toHaveLength(1);
    const audit = await t.db
      .select()
      .from(integrationCalls)
      .where(eq(integrationCalls.toolCallId, "tc-1"));
    expect(audit).toHaveLength(2);
    expect(audit.find((a) => a.replayOf)?.replayOf).toBe(audit.find((a) => !a.replayOf)?.id);
  });

  it("never shares a stored response across calls", async () => {
    const [a, b] = await slots();
    const first = await t.post(
      "/appointments",
      { patientId: JOHN_1980, slotToken: a?.slotToken, reason: "x" },
      "same-id",
      CALL_A,
    );
    const second = await t.post(
      "/appointments",
      { patientId: ALICE, slotToken: b?.slotToken, reason: "x" },
      "same-id",
      CALL_B,
    );
    expect(second.body.data.replayed).toBeUndefined();
    expect(second.body.data.appointmentId).not.toBe(first.body.data.appointmentId);
    expect(await t.db.select().from(appointments)).toHaveLength(2);
  });

  it("rejects a reused key with a different request", async () => {
    const [a, b] = await slots();
    await t.post(
      "/appointments",
      { patientId: JOHN_1980, slotToken: a?.slotToken, reason: "x" },
      "tc-2",
    );
    const reused = await t.post(
      "/appointments",
      { patientId: JOHN_1980, slotToken: b?.slotToken, reason: "x" },
      "tc-2",
    );
    expect(reused.status).toBe(422);
    expect(reused.body.error?.code).toBe("VALIDATION_ERROR");
    expect(await t.db.select().from(appointments)).toHaveLength(1);
  });

  it("asks the caller to retry while the first attempt holds a fresh lease", async () => {
    const [slot] = await slots();
    const body = { patientId: JOHN_1980, slotToken: slot?.slotToken, reason: "x" };
    await t.post("/appointments", body, "tc-3");
    await t.db
      .update(idempotencyKeys)
      .set({ status: "in_progress", lockedUntil: new Date(t.clock.now.getTime() + 10_000) })
      .where(eq(idempotencyKeys.toolCallId, "tc-3"));
    const busy = await t.post("/appointments", body, "tc-3");
    expect(busy.status).toBe(409);
    expect(busy.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE", retryable: true });
  });

  it("takes over a key whose lease expired", async () => {
    const [slot] = await slots();
    const body = { patientId: JOHN_1980, slotToken: slot?.slotToken, reason: "x" };
    const first = await t.post("/appointments", body, "tc-4");
    await t.db.delete(appointmentEvents);
    await t.db.delete(appointments);
    await t.db
      .update(idempotencyKeys)
      .set({ status: "in_progress", lockedUntil: new Date(t.clock.now.getTime() - 1) })
      .where(eq(idempotencyKeys.toolCallId, "tc-4"));
    const retry = await t.post("/appointments", body, "tc-4");
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data.replayed).toBeUndefined();
  });

  it("requires a call id with an idempotency key", async () => {
    const res = await t.call(
      "POST",
      "/appointments",
      { patientId: JOHN_1980, slotToken: "x", reason: "x" },
      { "Idempotency-Key": "k" },
    );
    expect(res.status).toBe(400);
  });

  it("completes the key in the same transaction as the booking", async () => {
    const [slot] = await slots();
    await t.post(
      "/appointments",
      { patientId: JOHN_1980, slotToken: slot?.slotToken, reason: "x" },
      "tc-5",
    );
    const [key] = await t.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.toolCallId, "tc-5"));
    expect(key).toMatchObject({ status: "completed", httpStatus: 201, callId: CALL_A });
  });
});
