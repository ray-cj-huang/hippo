import { expect, type Page } from "@playwright/test";

export async function startCall(page: Page, scenario: string) {
  await page.goto(`/?scenario=${scenario}`);
  await page.getByTestId("start-text").click();
  await expect(page.getByTestId("call-status")).toHaveText("Listening", { timeout: 15_000 });
}

export async function say(page: Page, text: string, { waitForReply = true } = {}) {
  const agentMessages = page.getByTestId("message-agent");
  const before = await agentMessages.count();
  await page.getByTestId("caller-input").fill(text);
  await page.getByTestId("caller-input").press("Enter");
  if (!waitForReply) return;
  await expect(agentMessages).toHaveCount(before + 1, { timeout: 15_000 });
  await expect(page.getByTestId("call-status")).toHaveText(/Listening|Call ended/, {
    timeout: 15_000,
  });
}

export function tool(page: Page, name: string) {
  return page.locator(`[data-testid=tool-call][data-tool=${name}]`);
}
