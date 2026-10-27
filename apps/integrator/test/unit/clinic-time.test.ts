import { describe, expect, it } from "vitest";
import { bookingWindow, ClinicTime } from "../../src/clinic-time";

const la = new ClinicTime("America/Los_Angeles");
const HOUR = 60 * 60 * 1000;

describe("ClinicTime", () => {
  it("resolves wall-clock times on both sides of the fall-back change", () => {
    expect(la.instant("2026-10-30", "09:00")).toEqual(new Date("2026-10-30T16:00:00Z"));
    expect(la.instant("2026-11-02", "09:00")).toEqual(new Date("2026-11-02T17:00:00Z"));
  });

  it("gives DST-change days their real length", () => {
    const fallBack = la.dayBounds("2026-11-01");
    const springForward = la.dayBounds("2026-03-08");
    expect(fallBack.end.getTime() - fallBack.start.getTime()).toBe(25 * HOUR);
    expect(springForward.end.getTime() - springForward.start.getTime()).toBe(23 * HOUR);
  });

  it("uses the clinic's date, not UTC's", () => {
    expect(la.localDate(new Date("2026-11-03T07:30:00Z"))).toBe("2026-11-02");
    expect(la.weekday("2026-11-02")).toBe(1);
  });

  it("labels instants in clinic time", () => {
    expect(la.label(new Date("2026-11-03T17:00:00Z"))).toBe("Tuesday, November 3rd at 9:00 AM");
    expect(la.dateLabel("2026-11-03")).toBe("Tuesday, November 3rd");
  });

  it("turns a year older on the clinic's calendar date", () => {
    expect(la.ageOn("2008-11-03", new Date("2026-11-03T07:59:00Z"))).toBe(17);
    expect(la.ageOn("2008-11-03", new Date("2026-11-03T08:00:00Z"))).toBe(18);
  });
});

describe("bookingWindow", () => {
  it("starts tomorrow and spans the configured days", () => {
    expect(bookingWindow(la, new Date("2026-11-02T16:00:00Z"), 30)).toEqual({
      today: "2026-11-02",
      earliest: "2026-11-03",
      latest: "2026-12-02",
    });
  });
});
