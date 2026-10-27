import { randomUUID } from "node:crypto";
import { CALL_ID_HEADER, TOOL_CALL_ID_HEADER } from "@hippo/contracts";
import { calls, createDb } from "@hippo/db";
import { resetDatabase, seedClinic } from "@hippo/db/testing";
import { createApp } from "../../src/app";
import type { Config } from "../../src/config";
import { createContext } from "../../src/context";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/hippo_test";

// Monday 2026-11-02 08:00 in Los Angeles (PST, after the DST change on Nov 1).
export const CALL_A = "00000000-0000-4000-8000-00000000ca11";
export const CALL_B = "00000000-0000-4000-8000-00000000cb11";

export const MONDAY_8AM = new Date("2026-11-02T16:00:00Z");
export const TUESDAY = "2026-11-03";
export const SATURDAY = "2026-11-07";

export const config: Config = {
  port: 0,
  slotTokenSecret: "test-secret-at-least-16-chars",
  slotTokenTtlSeconds: 30 * 60,
  clinicName: "Hippo Medical Center",
  timezone: "America/Los_Angeles",
  bookingWindowDays: 30,
  corsOrigins: ["http://localhost:3000"],
  serviceToken: "test-integrator-token-0123456789abcdef",
  adminEnabled: true,
};

export const AUTH = { authorization: `Bearer ${config.serviceToken}` };

export function createTestApp(overrides: Partial<Config> = {}) {
  const { db, sql } = createDb({ url: TEST_DATABASE_URL, max: 25 });
  const clock = { now: MONDAY_8AM };
  const ctx = createContext(db, { ...config, ...overrides }, () => clock.now);
  const app = createApp(ctx);

  async function call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...AUTH, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function caller(patientId: string, callId: string = randomUUID()) {
    await db
      .insert(calls)
      .values({ id: callId, patientId })
      .onConflictDoUpdate({ target: calls.id, set: { patientId } });
    const headers = { [CALL_ID_HEADER]: callId };
    return {
      callId,
      post: <T = ApiResult>(path: string, body: unknown, toolCallId?: string) =>
        call<T>(
          "POST",
          path,
          body,
          toolCallId ? { ...headers, [TOOL_CALL_ID_HEADER]: toolCallId } : headers,
        ),
      get: <T = ApiResult>(path: string) => call<T>("GET", path, undefined, headers),
    };
  }

  return {
    app,
    db,
    clock,
    call,
    caller,
    post: <T = ApiResult>(path: string, body: unknown, toolCallId?: string, callId = CALL_A) =>
      call<T>(
        "POST",
        path,
        body,
        toolCallId ? { [TOOL_CALL_ID_HEADER]: toolCallId, [CALL_ID_HEADER]: callId } : {},
      ),
    get: <T = ApiResult>(path: string) => call<T>("GET", path),
    reset: async () => {
      clock.now = MONDAY_8AM;
      await resetDatabase(db);
      await seedClinic(db);
    },
    close: () => sql.end(),
  };
}

export type ApiResult = {
  ok: boolean;
  message?: string;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary result fields
  data?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test assertions read arbitrary error details
  error?: { code: string; message: string; retryable: boolean; details?: any };
  warnings?: { code: string }[];
};
