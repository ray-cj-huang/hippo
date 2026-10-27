import { expect, test } from "@playwright/test";
import { say, startCall, tool } from "./helpers";

// Real Gemini and Cartesia; typed caller turns. Asserts outcomes, never exact wording.
test("a returning patient books with the real model", async ({ page }) => {
  await startCall(page, "live");
  const turns = [
    "Hi, I'd like a dermatology appointment for a rash.",
    "Alice Nguyen",
    "Yes, that's right.",
    "February 20th, 1975",
    "Yes.",
    "Next Wednesday, any time.",
    "The first one works.",
    "Yes, please book it.",
  ];
  for (const turn of turns) {
    await say(page, turn);
    if ((await tool(page, "book_appointment").count()) > 0) break;
  }
  await expect(tool(page, "verify_patient").last()).toHaveAttribute("data-status", "ok");
  await expect(tool(page, "book_appointment").last()).toHaveAttribute("data-status", "ok", {
    timeout: 30_000,
  });
});
