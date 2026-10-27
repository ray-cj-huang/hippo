import { expect, test } from "@playwright/test";

test("console loads and explains when the local backend is offline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hippo" })).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toBeVisible();
  await expect(page.getByTestId("start-voice")).toBeDisabled();
  await expect(page.getByTestId("start-text")).toBeDisabled();
  await expect(page.getByTestId("orb")).toBeVisible();
  await expect(page.getByText("Conversation")).toBeVisible();
});
