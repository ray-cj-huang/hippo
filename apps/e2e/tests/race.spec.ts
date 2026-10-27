import { expect, test } from "@playwright/test";
import { say, startCall, tool } from "./helpers";

test("two callers race for one slot: one books, the other is offered alternatives", async ({
  browser,
}) => {
  const john = await (await browser.newContext()).newPage();
  const alice = await (await browser.newContext()).newPage();

  await startCall(john, "race-john");
  await startCall(alice, "race-alice");

  // Both hear the same first opening before either books.
  await say(john, "I need a dermatology appointment, John Smith, May 12th 1980");
  await say(alice, "Dermatology please, Alice Nguyen, February 20th 1975");
  await expect(tool(john, "get_availability")).toHaveAttribute("data-status", "ok");
  await expect(tool(alice, "get_availability")).toHaveAttribute("data-status", "ok");

  await say(john, "Yes, book it");
  await say(alice, "Yes, book it");

  await expect(tool(john, "book_appointment")).toHaveAttribute("data-status", "ok");
  const lost = tool(alice, "book_appointment");
  await expect(lost).toHaveAttribute("data-status", "SLOT_TAKEN");
  await lost.locator("summary").click();
  await expect(lost).toContainText("alternatives");
  await expect(lost).toContainText("No appointment was created.");
});
