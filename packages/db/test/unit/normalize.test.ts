import { describe, expect, it } from "vitest";
import { normalizeName } from "../../src/normalize";

describe("normalizeName", () => {
  it("folds accents, case, punctuation and spacing", () => {
    expect(normalizeName("  María-José   O'Brien ")).toBe("mariajose obrien");
    expect(normalizeName("GONZÁLEZ")).toBe(normalizeName("gonzalez"));
  });

  it("keeps non-Latin letters", () => {
    expect(normalizeName("Zoë 李")).toBe("zoe 李");
  });
});
