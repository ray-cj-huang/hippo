import { describe, expect, it } from "vitest";
import { allowedTools, type CallState, checkTool } from "../../../src/tools/policy";

const fresh = (): CallState => ({
  callId: "c1",
  patientId: null,
  availabilityChecked: false,
  endRequested: false,
});

describe("ToolPolicy", () => {
  it("only offers identity, availability and hang-up at the start", () => {
    expect(allowedTools(fresh())).toEqual(["verify_patient", "get_availability", "end_call"]);
  });

  it("unlocks booking only after verification and availability", () => {
    const state = { ...fresh(), patientId: "p1" };
    expect(allowedTools(state)).not.toContain("book_appointment");
    expect(allowedTools({ ...state, availabilityChecked: true })).toContain("book_appointment");
  });

  it("rejects gated tools with an explanation", () => {
    expect(checkTool("list_appointments", fresh())).toMatchObject({
      ok: false,
      error: { code: "PATIENT_NOT_IDENTIFIED" },
    });
    expect(checkTool("book_appointment", { ...fresh(), patientId: "p1" })).toMatchObject({
      ok: false,
      error: { code: "AVAILABILITY_REQUIRED" },
    });
  });
});
