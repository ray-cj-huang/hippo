import type { Ctx } from "../context";

type AgeLimitedSpecialty = {
  id: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
};

export function ageRestriction(
  ctx: Ctx,
  specialty: AgeLimitedSpecialty,
  dob: string,
  on: Date,
): { message: string; suggestedSpecialty: string } | null {
  const age = ctx.time.ageOn(dob, on);
  if (specialty.maxAge !== null && age > specialty.maxAge) {
    return {
      message: `${specialty.name} only sees patients aged ${specialty.maxAge} and under; this patient is ${age}.`,
      suggestedSpecialty: "family_medicine",
    };
  }
  if (specialty.minAge !== null && age < specialty.minAge) {
    return {
      message: `${specialty.name} only sees patients aged ${specialty.minAge} and over; this patient is ${age}.`,
      suggestedSpecialty: "pediatrics",
    };
  }
  return null;
}

export function isPlausibleDob(ctx: Ctx, dob: string): boolean {
  const today = ctx.time.localDate(ctx.now());
  return dob <= today && ctx.time.ageOn(dob, ctx.now()) <= 120;
}
