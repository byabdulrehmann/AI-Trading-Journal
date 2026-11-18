import { expect, open, signUp, test } from "./helpers";

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

test("only the owner manages the FRED key, a malformed key is refused before FRED is asked, and it never comes back", async ({ page, browser, guard }) => {
  guard.allow(/status of 422/);
  await open(page, "/settings#market-data");
  const section = page.getByTestId("fred-key");
  await expect(section.getByText("not set")).toBeVisible();
  await section.getByLabel("FRED API key").fill("not-a-key");
  await section.getByRole("button", { name: "Save key" }).click();
  await expect(section.getByRole("alert")).toHaveText("A FRED key is 32 letters and digits.");
  expect(JSON.stringify(await (await page.request.get("/api/market/fred-key")).json())).toBe('{"configured":false}');

  const other = await browser.newPage();
  try {
    await signUp(other, "Other");
    expect((await other.request.get("/api/market/fred-key")).status()).toBe(403);
    expect((await other.request.put("/api/market/fred-key", { data: { key: "a".repeat(32) } })).status()).toBe(403);
    await other.goto("/market");
    await expect(other.getByText("Only the owner of this Jarvis can add it.")).toBeVisible({ timeout: 30_000 });
  } finally {
    await other.close();
  }
});
