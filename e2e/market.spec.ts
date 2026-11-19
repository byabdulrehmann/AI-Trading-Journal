import { expect, open, test } from "./helpers";

test("the Market page shows the CFTC positioning scorecard, or says why it can't", async ({ page }) => {
  await open(page, "/market");
  const card = page.getByTestId("positioning");
  await expect(card.getByRole("heading", { name: "Speculator positioning" })).toBeVisible();
  // Real data from the CFTC: without a network the card says so instead of showing anything made up.
  await expect(card.getByText("EURUSD", { exact: true }).or(card.getByRole("note")).first()).toBeVisible({ timeout: 30_000 });
  if (await card.getByText("EURUSD", { exact: true }).isVisible()) {
    await expect(card.getByRole("row", { name: /^EUR Euro/ })).toBeVisible();
    await expect(card.getByText(/positions as of/)).toBeVisible();
  }
  // No MT5 account here: seasonality and trend say where their prices come from instead of showing anything.
  await expect(card.getByText(/connected MT5 account/)).toBeVisible({ timeout: 30_000 });
  await expect(card.getByRole("link", { name: "Accounts" })).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/market.png`, fullPage: true });
});

test("a malformed FRED key is refused before FRED is asked, the key never comes back, and the Market page says how to add one", async ({ page, guard }) => {
  guard.allow(/status of 422/);
  await open(page, "/settings#market-data");
  const section = page.getByTestId("fred-key");
  await expect(section.getByText("not set")).toBeVisible();
  await section.getByLabel("FRED API key").fill("not-a-key");
  await section.getByRole("button", { name: "Save key" }).click();
  await expect(section.getByRole("alert")).toHaveText("A FRED key is 32 letters and digits.");
  expect(JSON.stringify(await (await page.request.get("/api/market/fred-key")).json())).toBe('{"configured":false}');
  // Owner only: the same requireOwner as the sign-up switch, whose refusal of other accounts security.spec.ts checks.
  await open(page, "/market");
  await expect(page.getByText("Only the owner of this Jarvis can add it.")).toBeVisible({ timeout: 30_000 });
});

test("calendar releases against forecast score each currency, and an empty calendar says how to add them", async ({ page }) => {
  await open(page, "/market");
  const card = page.getByTestId("positioning");
  await expect(card.getByRole("link", { name: "Economic calendar" })).toBeVisible({ timeout: 30_000 });

  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  for (const e of [
    { at: day(2), currency: "USD", title: "Retail sales", impact: "high", actual: "0.6%", forecast: "0.3%" },
    { at: day(3), currency: "USD", title: "Unemployment rate", impact: "medium", actual: "4.3%", forecast: "4.1%" },
    { at: day(4), currency: "EUR", title: "CPI flash", impact: "high", actual: "1.9%", forecast: "2.1%" },
    { at: day(45), currency: "EUR", title: "Too old to count", impact: "high", actual: "9%", forecast: "1%" },
  ])
    expect((await page.request.post("/api/events", { data: e })).status()).toBe(201);

  await page.reload();
  const table = card.getByRole("table", { name: "How each currency’s releases came in against forecast" });
  // USD: high beat (+3), unemployment up is a medium miss (−2): +0.2. EUR: high miss, the old one left out: −1.
  await expect(table.getByRole("row", { name: /^USD 1 1 Retail sales/ })).toContainText("+0.2");
  await expect(table.getByRole("row", { name: /^EUR 0 1 CPI flash/ })).toContainText("−1");
  await expect(card.getByText(/surprises/).first()).toBeVisible();
  if (process.env.SHOT_DIR) await table.screenshot({ path: `${process.env.SHOT_DIR}/surprises.png` });
  if (process.env.SHOT_DIR) await card.getByRole("list").screenshot({ path: `${process.env.SHOT_DIR}/pairs.png` });
});
