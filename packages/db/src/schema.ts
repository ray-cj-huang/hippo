import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const specialties = pgTable("specialties", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isPrimaryCare: boolean("is_primary_care").notNull().default(false),
  minAge: smallint("min_age"),
  maxAge: smallint("max_age"),
}).enableRLS();

export const doctors = pgTable(
  "doctors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specialtyId: text("specialty_id")
      .notNull()
      .references(() => specialties.id),
    title: text("title").notNull().default("Dr."),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("doctors_specialty_idx").on(t.specialtyId)],
).enableRLS();

export const doctorSchedules = pgTable(
  "doctor_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index("doctor_schedules_doctor_idx").on(t.doctorId, t.weekday)],
).enableRLS();

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    firstNameNorm: text("first_name_norm").notNull(),
    lastNameNorm: text("last_name_norm").notNull(),
    dob: date("dob").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("patients_identity_uq").on(t.lastNameNorm, t.firstNameNorm, t.dob)],
).enableRLS();

export const appointmentStatus = pgEnum("appointment_status", ["booked", "cancelled"]);

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  patientId: uuid("patient_id").references(() => patients.id),
  llmProvider: text("llm_provider"),
  llmModel: text("llm_model"),
  endReason: text("end_reason"),
}).enableRLS();

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    reason: text("reason"),
    rescheduledTo: uuid("rescheduled_to"),
    ...timestamps,
  },
  (t) => [
    // Partial so that cancelling frees the slot.
    uniqueIndex("appointments_doctor_slot_booked_uq")
      .on(t.doctorId, t.startAt)
      .where(sql`${t.status} = 'booked'`),
    uniqueIndex("appointments_patient_slot_booked_uq")
      .on(t.patientId, t.startAt)
      .where(sql`${t.status} = 'booked'`),
    index("appointments_patient_start_idx").on(t.patientId, t.startAt),
  ],
).enableRLS();

export const callEvents = pgTable(
  "call_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
  },
  (t) => [index("call_events_call_idx").on(t.callId, t.at)],
).enableRLS();

export const integrationCalls = pgTable(
  "integration_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").references(() => calls.id),
    toolCallId: text("tool_call_id"),
    tool: text("tool").notNull(),
    patientId: uuid("patient_id").references(() => patients.id),
    request: jsonb("request").notNull(),
    response: jsonb("response"),
    httpStatus: smallint("http_status"),
    ok: boolean("ok"),
    errorCode: text("error_code"),
    replayOf: uuid("replay_of"),
    latencyMs: integer("latency_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("integration_calls_call_idx").on(t.callId, t.startedAt),
    index("integration_calls_patient_idx").on(t.patientId, t.startedAt),
    index("integration_calls_error_idx").on(t.errorCode, t.startedAt),
  ],
).enableRLS();

export const idempotencyStatus = pgEnum("idempotency_status", ["in_progress", "completed"]);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    callId: uuid("call_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    tool: text("tool").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("in_progress"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
    httpStatus: smallint("http_status"),
    response: jsonb("response"),
    integrationCallId: uuid("integration_call_id").references(() => integrationCalls.id),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.callId, t.toolCallId, t.tool] })],
).enableRLS();

export const appointmentEventType = pgEnum("appointment_event_type", [
  "booked",
  "cancelled",
  "rescheduled_out",
  "rescheduled_in",
]);

export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    type: appointmentEventType("type").notNull(),
    integrationCallId: uuid("integration_call_id").references(() => integrationCalls.id),
    callId: uuid("call_id").references(() => calls.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [index("appointment_events_appointment_idx").on(t.appointmentId, t.at)],
).enableRLS();
