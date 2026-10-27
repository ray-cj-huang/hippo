import { describe, expect, it } from "vitest";
import { SlotTokens } from "../../src/slot-token";

const tokens = new SlotTokens("unit-test-secret-123", 600);
const slot = {
  doctorId: "00000000-0000-4000-8000-000000000401",
  startAt: new Date("2026-11-03T17:00:00Z"),
};
const now = new Date("2026-11-02T16:00:00Z");

describe("SlotTokens", () => {
  it("round-trips a slot", () => {
    expect(tokens.verify(tokens.issue(slot, now), now)).toEqual({ ok: true, slot });
  });

  it("rejects tampered payloads", () => {
    const [, sig] = tokens.issue(slot, now).split(".");
    const forged = Buffer.from(
      JSON.stringify({ d: slot.doctorId, s: "2026-11-03T18:00:00.000Z", e: 9e9 }),
    ).toString("base64url");
    expect(tokens.verify(`${forged}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("expires after the TTL", () => {
    const later = new Date(now.getTime() + 601_000);
    expect(tokens.verify(tokens.issue(slot, now), later)).toEqual({ ok: false, reason: "expired" });
  });
});
