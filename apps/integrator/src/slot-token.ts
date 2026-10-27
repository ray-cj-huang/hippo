import { createHmac, timingSafeEqual } from "node:crypto";
import type { Result } from "@hippo/contracts";
import { z } from "zod";

const Payload = z.object({ d: z.uuid(), s: z.iso.datetime(), e: z.number().int() });

export type SlotRef = { doctorId: string; startAt: Date };

export class SlotTokens {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(slot: SlotRef, now: Date): string {
    const payload = Buffer.from(
      JSON.stringify({
        d: slot.doctorId,
        s: slot.startAt.toISOString(),
        e: Math.floor(now.getTime() / 1000) + this.ttlSeconds,
      }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string, now: Date): Result<SlotRef, "invalid" | "expired"> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return { ok: false, error: "invalid" };

    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, error: "invalid" };
    }

    const parsed = Payload.safeParse(safeJson(Buffer.from(payload, "base64url").toString()));
    if (!parsed.success) return { ok: false, error: "invalid" };
    if (parsed.data.e * 1000 < now.getTime()) return { ok: false, error: "expired" };
    return { ok: true, data: { doctorId: parsed.data.d, startAt: new Date(parsed.data.s) } };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
