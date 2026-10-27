import { describe, expect, it } from "vitest";
import { hashRequest } from "../../src/idempotency";

describe("hashRequest", () => {
  it("ignores key order and undefined fields", () => {
    expect(hashRequest({ a: 1, b: { c: [1, 2], d: undefined } })).toBe(
      hashRequest({ b: { c: [1, 2] }, a: 1 }),
    );
  });

  it("distinguishes different values and array order", () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
    expect(hashRequest([1, 2])).not.toBe(hashRequest([2, 1]));
  });
});
