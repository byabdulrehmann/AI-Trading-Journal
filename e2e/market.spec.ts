import { expect, open, test } from "./helpers";

test("the Market page shows the CFTC positioning scorecard, or says why it can't", async ({ page }) => {
  await open(page, "/market");
  const card = page.getByTestId("positioning");
  await expect(card.getByRole("heading", { name: "Speculator positioning" })).toBeVisible();
  // Real data from the CFTC: without a network the card says so instead of showing anything made up.
  await expect(card.getByText("EURUSD", { exact: true }).or(card.getByRole("note"))).toBeVisible({ timeout: 30_000 });
  if (await card.getByText("EURUSD", { exact: true }).isVisible()) {
    await expect(card.getByRole("row", { name: /^EUR Euro/ })).toBeVisible();
    await expect(card.getByText(/positions as of/)).toBeVisible();
  }
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/market.png`, fullPage: true });
});
