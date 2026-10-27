import { failure, type ToolName, type ToolResult } from "@hippo/contracts";

export type CallState = {
  callId: string;
  patientId: string | null;
  availabilityChecked: boolean;
  endRequested: boolean;
};

const needsPatient = new Set<ToolName>([
  "book_appointment",
  "list_appointments",
  "cancel_appointment",
  "reschedule_appointment",
]);
const needsAvailability = new Set<ToolName>(["book_appointment", "reschedule_appointment"]);

export function allowedTools(state: CallState): ToolName[] {
  const tools: ToolName[] = ["verify_patient", "get_availability", "end_call"];
  if (state.patientId) tools.push("list_appointments", "cancel_appointment");
  if (state.patientId && state.availabilityChecked)
    tools.push("book_appointment", "reschedule_appointment");
  return tools;
}

export function checkTool(name: ToolName, state: CallState): ToolResult<never> | null {
  if (needsPatient.has(name) && !state.patientId) {
    return failure(
      "PATIENT_NOT_IDENTIFIED",
      "The caller has not been verified yet. Nothing was done. Confirm their name spelling and date of birth, then call verify_patient.",
    );
  }
  if (needsAvailability.has(name) && !state.availabilityChecked) {
    return failure(
      "AVAILABILITY_REQUIRED",
      "Availability has not been checked on this call. Nothing was booked. Call get_availability first.",
    );
  }
  return null;
}
