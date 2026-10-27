import { createHash, timingSafeEqual } from "node:crypto";
import { failure } from "@hippo/contracts";
import { createMiddleware } from "hono/factory";
import { respond } from "./http";

const BEARER = "Bearer ";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export function requireServiceToken(token: string) {
  const expected = digest(token);
  return createMiddleware(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith(BEARER) ? header.slice(BEARER.length) : "";
    if (!timingSafeEqual(digest(given), expected)) {
      return respond(
        c,
        failure("UNAUTHORIZED", "Missing or invalid service token. Nothing was changed."),
      );
    }
    await next();
  });
}
