import { expect, test } from "@playwright/test";
import { say, startCall, tool } from "./helpers";

test("new patient books an orthopedics appointment and hangs up", async ({ page }) => {
  await startCall(page, "new-patient-book");
  await expect(page.getByTestId("message-agent").first()).toContainText(
    "Thanks for calling Hippo Medical Center",
  );

  await say(page, "I hurt my ankle playing soccer");
  await say(page, "Maria Gonzalez");
  await say(page, "Yes, March 3rd 1990");
  await expect(tool(page, "verify_patient").first()).toHaveAttribute(
    "data-status",
    "PATIENT_NOT_FOUND",
  );

  await say(page, "Yes, that's right");
  await expect(tool(page, "verify_patient")).toHaveCount(1);
  await say(page, "Yes, I'm a new patient");
  await expect(tool(page, "get_availability")).toHaveAttribute("data-status", "ok");

  await say(page, "Yes please");
  await expect(tool(page, "book_appointment")).toHaveAttribute("data-status", "ok");
  await expect(
    page.getByTestId("db-appointments").getByTestId("db-row").filter({ hasText: "Maria Gonzalez" }),
  ).toContainText("booked");

  await page
    .getByTestId("db-appointments")
    .getByTestId("db-row")
    .filter({ hasText: "Maria Gonzalez" })
    .click();
  const detail = page.getByTestId("db-detail");
  await expect(detail).toContainText("Orthopedics");
  await detail.getByTestId("db-row").filter({ hasText: "Maria Gonzalez" }).click();
  await expect(detail).toContainText("1990-03-03");
  await page.getByTestId("db-back").click();
  await page.getByTestId("db-back").click();
  await expect(page.getByTestId("db-appointments")).toBeVisible();

  await say(page, "No, that's all");
  await expect(page.getByTestId("call-status")).toHaveText("Call ended");
});

test("booking before checking availability is blocked", async ({ page }) => {
  await startCall(page, "book-without-availability");
  await say(page, "Book me with anyone, John Smith, November 30th 1992");
  await expect(tool(page, "verify_patient")).toHaveAttribute("data-status", "ok");
  await expect(tool(page, "book_appointment")).toHaveAttribute(
    "data-status",
    "AVAILABILITY_REQUIRED",
  );
});

test("an emergency ends the call without booking", async ({ page }) => {
  await startCall(page, "emergency");
  await say(page, "I have crushing chest pain");
  await expect(page.getByTestId("call-status")).toHaveText("Call ended");
  await expect(page.locator("[data-testid=tool-call]")).toHaveCount(1);
  await expect(tool(page, "end_call")).toHaveAttribute("data-status", "ok");
});

test("the agent says goodbye before hanging up", async ({ page }) => {
  await startCall(page, "silent-end-call");
  await say(page, "That's it", { waitForReply: false });
  await expect(page.getByTestId("call-status")).toHaveText("Call ended");
  await expect(page.getByTestId("message-agent").last()).toContainText("Goodbye");
});

test("the caller can interrupt the agent", async ({ page }) => {
  await startCall(page, "long-answer");
  await say(page, "Tell me about the clinic", { waitForReply: false });
  await expect(page.getByTestId("call-status")).toHaveText("Speaking", { timeout: 15_000 });
  await say(page, "Actually I just need to book");
  await expect(page.getByText("Interrupted by caller")).toBeVisible();
});

test("the caller can interrupt the greeting", async ({ page }) => {
  await page.goto("/?scenario=long-answer");
  // The greeting plays for under 300 ms, faster than a Playwright round trip; reply in-page.
  const replied = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const input = document.querySelector<HTMLInputElement>("[data-testid=caller-input]");
          if (!input || !document.querySelector("[data-testid=message-agent]")) return;
          observer.disconnect();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            input,
            "Hi, I need an appointment",
          );
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.form?.requestSubmit();
          resolve();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }),
  );
  await page.getByTestId("start-text").click();
  await replied;
  const greeting = page.getByTestId("message-agent").first();
  await expect(greeting.getByText("Interrupted by caller")).toBeVisible();
  await expect(greeting.getByTestId("unheard-text")).toContainText("How can I help you today?");
});

test("interrupting after a tool call keeps what the caller heard", async ({ page }) => {
  await startCall(page, "speak-then-tool");
  await say(page, "Any dermatology openings next Wednesday?", { waitForReply: false });
  await expect(tool(page, "get_availability")).toHaveAttribute("data-status", "ok");
  await say(page, "Actually, never mind");

  const answer = page.getByTestId("message-agent").nth(1);
  await expect(answer.getByText("Interrupted by caller")).toBeVisible();
  await expect(answer.getByTestId("heard-text")).toHaveText(/^Let me check that\./);
  await expect(answer.getByTestId("unheard-text")).toContainText("Which one works best");
});
