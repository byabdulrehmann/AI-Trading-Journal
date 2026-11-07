import { expect, figure, loadSample, open, range, test, usd } from "./helpers";
import type { Page } from "@playwright/test";

const analytics = async (page: Page) => (await page.request.get("/api/analytics?includeSample=1")).json();

/** "1 to 50 of 123" gives 123. */
const journalTotal = async (page: Page) => {
  await expect(range(page)).toBeVisible();
  return Number((await range(page).textContent())!.split(" of ")[1].replace(/,/g, ""));
};

test("an instrument row and a direction row land on a journal with the same count", async ({ page }) => {
  await loadSample(page);
  const a = await analytics(page);

  for (const [key, link, param] of [[a.breakdowns.symbol[0].key, a.breakdowns.symbol[0].key, "symbol"], ["long", "Long", "side"]] as const) {
    await open(page, "/analytics?includeSample=1&tab=instruments");
    const expected = a.breakdowns[param === "side" ? "side" : "symbol"].find((x: { key: string }) => x.key === key);
    await page.locator(`tr[data-row="${key}"]`).getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(new RegExp(`/journal\\?.*${param}=${key}`));
    await expect(page).toHaveURL(/closedOnly=1/);
    await expect(page).toHaveURL(/includeSample=1/);
    expect(await journalTotal(page)).toBe(expected.trades);
  }
});

test("a heatmap cell lands on a journal whose total equals its count", async ({ page }) => {
  await loadSample(page);
  const a = await analytics(page);
  const cells = [...a.breakdowns.heatmap].sort((x: { trades: number }, y: { trades: number }) => y.trades - x.trades);
  const cell = cells[0] as { key: string; trades: number; netPnl: number };
  const [day, hour] = cell.key.split("-");
  expect(cell.trades).toBeGreaterThan(0);

  await open(page, "/analytics?includeSample=1&tab=time");
  const td = page.locator(`td[data-cell="${cell.key}"]`);
  await td.hover();
  await expect(page.locator("p > span.num").filter({ hasText: `${cell.trades} ${cell.trades === 1 ? "trade" : "trades"}, ${usd(cell.netPnl)}` })).toBeVisible();
  await td.click();
  await expect(page).toHaveURL(new RegExp(`/journal\\?.*weekday=${day}`));
  await expect(page).toHaveURL(new RegExp(`hour=${hour}`));
  await expect(page).toHaveURL(/closedOnly=1/);
  expect(await journalTotal(page)).toBe(cell.trades);

  // The second-busiest cell, by keyboard this time.
  const other = cells[1] as { key: string; trades: number };
  await open(page, "/analytics?includeSample=1&tab=time");
  await page.locator(`td[data-cell="${other.key}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/journal\?/);
  expect(await journalTotal(page)).toBe(other.trades);
});

test("period switch redraws the chart, stays in the URL, and a bar opens its trades", async ({ page }) => {
  await loadSample(page);
  const a = await analytics(page);
  await open(page, "/analytics?includeSample=1");
  const bars = page.locator("rect[data-bar]");
  const period = page.getByRole("radiogroup", { name: "Period" });

  await expect(period.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
  await expect(bars).toHaveCount(a.periods.month.length);

  for (const [label, key] of [["Week", "week"], ["Day", "day"], ["Year", "year"]] as const) {
    await period.getByRole("radio", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`period=${key}`));
    await expect(period.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
    await expect(bars).toHaveCount(a.periods[key].length);
  }

  await period.getByRole("radio", { name: "Week" }).click();
  await expect(page).toHaveURL(/period=week/);
  await page.reload();
  await expect(period.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
  await expect(bars).toHaveCount(a.periods.week.length);

  // The figures above the chart don't move with the period.
  await expect(figure(page, "Closed trades")).toHaveText(String(a.metrics.closedTrades));
  await expect(figure(page, "Net P&L")).toHaveText(usd(a.metrics.netPnl));

  const week = a.periods.week[0] as { key: string; trades: number };
  await page.locator(`rect[data-bar="${week.key}"]`).click({ force: true });
  await expect(page).toHaveURL(/\/journal\?.*closedFrom=/);
  expect(await journalTotal(page)).toBe(week.trades);
});
