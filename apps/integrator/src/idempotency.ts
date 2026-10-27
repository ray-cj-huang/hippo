import { createHash } from "node:crypto";
import type { ToolResult } from "@hippo/contracts";
import { type Db, idempotencyKeys } from "@hippo/db";
import { and, eq, lt } from "drizzle-orm";

const LEASE_MS = 30_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type KeyRef = { callId: string; toolCallId: string; tool: string };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type Claim =
  | { kind: "acquired" }
  | { kind: "replay"; httpStatus: number; response: unknown; integrationCallId: string | null }
  | { kind: "busy" }
  | { kind: "mismatch" };

export function hashRequest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function matches(key: KeyRef) {
  return and(
    eq(idempotencyKeys.callId, key.callId),
    eq(idempotencyKeys.toolCallId, key.toolCallId),
    eq(idempotencyKeys.tool, key.tool),
  );
}

export async function claimKey(
  db: Db,
  key: KeyRef,
  requestHash: string,
  integrationCallId: string,
  now: Date,
): Promise<Claim> {
  const lockedUntil = new Date(now.getTime() + LEASE_MS);
  const [inserted] = await db
    .insert(idempotencyKeys)
    .values({ ...key, requestHash, lockedUntil, integrationCallId })
    .onConflictDoNothing({
      target: [idempotencyKeys.callId, idempotencyKeys.toolCallId, idempotencyKeys.tool],
    })
    .returning({ status: idempotencyKeys.status });
  if (inserted) return { kind: "acquired" };

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(idempotencyKeys).where(matches(key)).for("update");
    if (!existing) {
      await tx
        .insert(idempotencyKeys)
        .values({ ...key, requestHash, lockedUntil, integrationCallId });
      return { kind: "acquired" } as const;
    }
    if (existing.requestHash !== requestHash) return { kind: "mismatch" } as const;
    if (existing.status === "completed" && existing.httpStatus !== null) {
      return {
        kind: "replay",
        httpStatus: existing.httpStatus,
        response: existing.response,
        integrationCallId: existing.integrationCallId,
      } as const;
    }
    if (existing.lockedUntil.getTime() > now.getTime()) return { kind: "busy" } as const;
    // The previous holder died or hung past its lease; take over.
    await tx.update(idempotencyKeys).set({ lockedUntil, integrationCallId }).where(matches(key));
    return { kind: "acquired" } as const;
  });
}

/** Records the response; call inside the transaction that made the change so both commit together. */
export async function completeKey(
  db: Db | Tx,
  key: KeyRef,
  result: ToolResult<unknown>,
  httpStatus: number,
) {
  await db
    .update(idempotencyKeys)
    .set({ status: "completed", response: result, httpStatus })
    .where(and(matches(key), eq(idempotencyKeys.status, "in_progress")));
}

export async function releaseKey(db: Db, key: KeyRef) {
  await db
    .delete(idempotencyKeys)
    .where(and(matches(key), eq(idempotencyKeys.status, "in_progress")));
}

export async function purgeIdempotencyKeys(db: Db, now: Date) {
  await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, new Date(now.getTime() - RETENTION_MS)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
