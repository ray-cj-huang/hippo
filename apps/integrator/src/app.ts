import {
  AvailabilityRequest,
  BookAppointmentRequest,
  CallEventsRequest,
  EndCallRequest,
  failure,
  RescheduleAppointmentRequest,
  StartCallRequest,
  VerifyPatientRequest,
} from "@hippo/contracts";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { requireServiceToken } from "./auth";
import type { Ctx } from "./context";
import { parseJson, respond } from "./http";
import { type RecorderVariables, recordIntegrationCall } from "./integration-calls";
import { adminSnapshot } from "./services/admin";
import {
  type ActionMeta,
  bookAppointment,
  cancelAppointment,
  listAppointments,
  rescheduleAppointment,
} from "./services/appointments";
import { getAvailability } from "./services/availability";
import { appendCallEvents, endCall, startCall } from "./services/calls";
import { getClinic } from "./services/clinic";
import { verifyPatient } from "./services/patients";

const Uuid = z.uuid();
type Env = { Variables: RecorderVariables };

function meta(c: Context<Env>): ActionMeta {
  return {
    integrationCallId: c.get("integrationCallId") ?? null,
    callId: c.get("callId") ?? null,
    key: c.get("idempotencyKey") ?? null,
  };
}

function notIdentified(unchanged: string) {
  return failure(
    "PATIENT_NOT_IDENTIFIED",
    `No patient has been verified on this call. ${unchanged} Call verify_patient first.`,
  );
}

export function createApp(ctx: Ctx) {
  const app = new Hono<Env>();
  const record = (tool: Parameters<typeof recordIntegrationCall>[1]) =>
    recordIntegrationCall(ctx.db, tool, ctx.now);

  app.use("/admin/*", cors({ origin: ctx.config.corsOrigins }));
  app.use("/health", cors({ origin: ctx.config.corsOrigins }));

  app.get("/health", (c) => c.json({ ok: true }));
  if (ctx.config.adminEnabled) {
    app.get("/admin/snapshot", async (c) => c.json(await adminSnapshot(ctx)));
  }

  // Routes registered above stay public; everything below needs phoner's token.
  app.use("*", requireServiceToken(ctx.config.serviceToken));

  app.get("/clinic", async (c) => c.json(await getClinic(ctx)));

  app.post("/calls", async (c) => {
    const body = await parseJson(c, StartCallRequest);
    if (!body.ok) return respond(c, body);
    await startCall(ctx, body.data);
    return c.body(null, 204);
  });

  app.post("/calls/:id/end", async (c) => {
    const id = Uuid.safeParse(c.req.param("id"));
    const body = await parseJson(c, EndCallRequest);
    if (!id.success || !body.ok)
      return respond(c, failure("VALIDATION_ERROR", "Invalid call id or body."));
    await endCall(ctx, id.data, body.data.reason);
    return c.body(null, 204);
  });

  app.post("/calls/:id/events", async (c) => {
    const id = Uuid.safeParse(c.req.param("id"));
    const body = await parseJson(c, CallEventsRequest);
    if (!id.success || !body.ok)
      return respond(c, failure("VALIDATION_ERROR", "Invalid call id or events."));
    await appendCallEvents(ctx, id.data, body.data);
    return c.body(null, 204);
  });

  app.post("/availability", record("get_availability"), async (c) => {
    const body = await parseJson(c, AvailabilityRequest);
    return respond(c, body.ok ? await getAvailability(ctx, body.data, c.get("patientId")) : body);
  });

  app.post("/patients/verify", record("verify_patient"), async (c) => {
    const body = await parseJson(c, VerifyPatientRequest);
    return respond(c, body.ok ? await verifyPatient(ctx, body.data) : body);
  });

  app.get("/appointments", record("list_appointments"), async (c) => {
    const patientId = c.get("patientId");
    if (!patientId) return respond(c, notIdentified("Nothing was listed."));
    return respond(c, await listAppointments(ctx, patientId));
  });

  app.post("/appointments", record("book_appointment"), async (c) => {
    const patientId = c.get("patientId");
    if (!patientId) return respond(c, notIdentified("No appointment was created."));
    const body = await parseJson(c, BookAppointmentRequest);
    return respond(
      c,
      body.ok ? await bookAppointment(ctx, patientId, body.data, meta(c)) : body,
      201,
    );
  });

  app.post("/appointments/:id/cancel", record("cancel_appointment"), async (c) => {
    const patientId = c.get("patientId");
    if (!patientId) return respond(c, notIdentified("Nothing was cancelled."));
    const id = Uuid.safeParse(c.req.param("id"));
    if (!id.success)
      return respond(
        c,
        failure("NOT_YOUR_APPOINTMENT", "No such appointment. Nothing was cancelled."),
      );
    return respond(c, await cancelAppointment(ctx, id.data, patientId, meta(c)));
  });

  app.post("/appointments/:id/reschedule", record("reschedule_appointment"), async (c) => {
    const patientId = c.get("patientId");
    if (!patientId) return respond(c, notIdentified("Nothing was changed."));
    const id = Uuid.safeParse(c.req.param("id"));
    const body = await parseJson(c, RescheduleAppointmentRequest);
    if (!id.success)
      return respond(
        c,
        failure("NOT_YOUR_APPOINTMENT", "No such appointment. Nothing was changed."),
      );
    return respond(
      c,
      body.ok ? await rescheduleAppointment(ctx, id.data, patientId, body.data, meta(c)) : body,
    );
  });

  app.onError((error, c) => {
    console.error(JSON.stringify({ level: "error", path: c.req.path, message: error.message }));
    return respond(
      c,
      failure(
        "INTERNAL_ERROR",
        "An unexpected error occurred. It is not known whether anything changed.",
        {
          retryable: true,
        },
      ),
    );
  });

  return app;
}
