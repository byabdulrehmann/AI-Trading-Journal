import type { Page } from "@playwright/test";
import { dialog, expect, field, fillBasics, figure, importCsv, loadSample, open, rows, test, usd } from "./helpers";

const SET = [
  "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1000,1.1100,1000,1.0900,,0", // long +10
  "GBPUSD,sell,2026-10-14 11:00,2026-10-14 12:00,1.3000,1.2800,1000,1.3100,,0", // short +20
  "EURUSD,buy,2026-10-15 09:00,2026-10-15 10:00,1.1000,1.0950,1000,1.0900,,0", // long -5
];

const settings = (page: Page, data: Record<string, unknown>) => page.request.patch("/api/settings", { data });
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name, exact: true }).click();

test("a filter set on one page follows you to the others, until cleared", async ({ page }) => {
  await importCsv(page, SET);
  // Journal first: a page already visited must pick the filter up when you come back to it.
  await open(page, "/journal");
  await nav(page, "Analytics");
  await page.getByRole("button", { name: "More filters" }).click();
  await page.getByRole("combobox", { name: "Direction" }).selectOption("short");
  await expect(page).toHaveURL(/side=short/);
  await expect(page.getByText(usd(20), { exact: true }).first()).toBeVisible();

  await nav(page, "Journal");
  await expect(page).toHaveURL(/\/journal\?.*side=short/);
  await expect(page.getByRole("combobox", { name: "Direction" })).toHaveValue("short");
  await expect(page.getByRole("checkbox", { name: /Select trade/ })).toHaveCount(1);

  await nav(page, "Settings");
  await nav(page, "Dashboard");
  await expect(page).toHaveURL(/side=short/);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page).not.toHaveURL(/side=short/);
  await nav(page, "Journal");
  await expect(page).not.toHaveURL(/side=short/);
  await expect(page.getByRole("checkbox", { name: /Select trade/ })).toHaveCount(3);
});

test("number filters ignore what isn't a number", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/journal");
  await page.getByRole("button", { name: "More filters" }).click();
  const from = page.getByLabel("R from");
  await from.fill("abc");
  await from.press("Enter");
  await expect(page).not.toHaveURL(/rMin/);
  await from.fill("1");
  await from.press("Enter");
  await expect(page).toHaveURL(/rMin=1/);
  // Longs at +1R and short at +2R stay; the loser at -0.5R goes.
  await expect(page.getByRole("checkbox", { name: /Select trade/ })).toHaveCount(2);
});

test("a chosen time zone moves days, labels and typed times", async ({ page }) => {
  const account = (await (await page.request.get("/api/accounts")).json()).accounts[0].id;
  const made = await page.request.post("/api/trades", { data: { accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-07-01T02:30:00.000Z", closedAt: "2026-07-01T03:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000 } });
  expect(made.ok()).toBe(true);
  try {
    await open(page, "/settings");
    await page.getByLabel("Time zone").selectOption("America/New_York");
    await expect.poll(async () => (await (await page.request.get("/api/settings")).json()).settings.timeZone).toBe("America/New_York");

    const days = async () => (await (await page.request.get("/api/analytics")).json()).periods.day.map((r: { key: string }) => r.key);
    expect(await days()).toEqual(["2026-06-30"]);

    await open(page, "/journal");
    await page.getByRole("button", { name: "Log trade" }).first().click();
    const form = dialog(page);
    await fillBasics(form, { symbol: "GBPUSD", opened: "2026-07-01T10:00", closed: "2026-07-01T11:00", entry: "1.3", exit: "1.31", quantity: "1000" });
    await form.getByRole("button", { name: "Save trade" }).click();
    await expect(page.getByText("Logged GBPUSD.")).toBeVisible();
    const trades = (await (await page.request.get("/api/trades?symbol=GBPUSD")).json()).trades;
    expect(trades[0].openedAt).toBe("2026-07-01T14:00:00.000Z"); // 10:00 in New York, summer time

    await open(page, "/calendar?month=2026-06");
    await expect(page.locator('[data-day="2026-06-30"]')).toHaveAccessibleName(/1 trade/);
    await expect(page.getByText("New York time").first()).toBeVisible();
  } finally {
    await settings(page, { timeZone: "" });
  }
});

test("an option asks for its details, defaults to 100 per contract and shows them", async ({ page }) => {
  await open(page, "/journal");
  await page.getByRole("button", { name: "Log trade" }).first().click();
  const form = dialog(page);
  await fillBasics(form, { symbol: "AAPL C190", opened: "2026-10-14T09:00", closed: "2026-10-14T10:00", entry: "4.2", exit: "5.7", quantity: "2" });
  await form.getByRole("button", { name: /^Asset class and session/ }).click();
  await field(form, "Asset class").selectOption("option");
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(form.getByText("Choose call or put")).toBeVisible();
  await expect(form.getByText("Enter the strike")).toBeVisible();

  await field(form, "Call or put").selectOption("call");
  await field(form, "Strike").fill("190");
  await field(form, "Expiry").fill("2026-11-20");
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Logged AAPL C190.")).toBeVisible();

  const [t] = (await (await page.request.get("/api/trades?symbol=AAPL%20C190")).json()).trades;
  expect(t.pnl).toBe(300); // 1.50 x 2 x 100
  await open(page, "/journal");
  await rows(page).first().getByRole("button", { name: /AAPL C190/ }).or(rows(page).first().getByRole("link", { name: /AAPL C190/ })).first().click();
  await expect(page.getByText("call 190, expires 2026-11-20")).toBeVisible();
});

test("fee defaults start a new manual trade, and can be changed there", async ({ page }) => {
  try {
    await open(page, "/settings");
    const commission = page.locator("#defaults").getByLabel("Commission");
    await commission.fill("2.5");
    await commission.blur();
    await expect.poll(async () => (await (await page.request.get("/api/settings")).json()).settings.feeDefaults.commission).toBe(2.5);
    await page.reload();
    await page.getByRole("button", { name: "Log trade" }).first().click();
    await expect(field(dialog(page), "Commission")).toHaveValue("2.5");
  } finally {
    await settings(page, { feeDefaults: { commission: 0, otherFees: 0 } });
  }
});

test("the sample journal is large, spans accounts, and a mistake row opens matching trades", async ({ page }) => {
  await loadSample(page);
  const a = await (await page.request.get("/api/analytics?includeSample=1")).json();
  expect(a.metrics.closedTrades).toBeGreaterThanOrEqual(300);
  expect(a.breakdowns.account.length).toBe(3);
  for (const c of ["option", "stock", "future", "forex", "crypto"]) expect(a.breakdowns.assetClass.map((r: { key: string }) => r.key)).toContain(c);

  await open(page, "/analytics?includeSample=1");
  await expect(page.getByRole("heading", { name: "Mistakes" })).toBeVisible();
  await expect(figure(page, "Closed trades")).toHaveText(String(a.metrics.closedTrades));
  const row = a.breakdowns.mistake[0];
  await page.locator(`[data-row="${row.key}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/journal\\?.*mistake=${row.key}`));
  const list = await (await page.request.get(`/api/trades?includeSample=1&closedOnly=1&mistake=${row.key}&pageSize=1`)).json();
  expect(list.total).toBe(row.trades);
  await expect(page.getByText(`of ${row.trades}`).first()).toBeVisible();
});
