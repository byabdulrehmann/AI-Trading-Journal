import { expect, figure, loadSample, test, usd, r } from "./helpers";
import type { Page } from "@playwright/test";




async function analytics(page: Page, query = "includeSample=1") {
  return (await page.request.get(`/api/analytics?${query}`)).json();
}

async function expectFiguresMatch(page: Page, a: Awaited<ReturnType<typeof analytics>>) {
  const m = a.metrics;
  await expect(figure(page, "Net P&L")).toHaveText(usd(m.netPnl));
  await expect(figure(page, "Gross profit")).toHaveText(usd(m.grossProfit, false));
  await expect(figure(page, "Gross loss")).toHaveText(usd(m.grossLoss, false));
  await expect(figure(page, "Win rate")).toHaveText(`${(m.winRate * 100).toFixed(1)}%`);
  await expect(figure(page, "Profit factor")).toHaveText(m.profitFactor.toFixed(2));
  await expect(figure(page, "Expectancy")).toHaveText(usd(m.expectancy));
  await expect(figure(page, "Average R")).toHaveText(r(m.avgR));
  await expect(figure(page, "Max drawdown")).toHaveText(usd(-m.maxDrawdown));
  await expect(figure(page, "Total fees")).toHaveText(usd(m.totalFees, false));
  await expect(figure(page, "Total trades")).toHaveText(String(m.totalTrades));
  await expect(figure(page, "Closed")).toHaveText(String(m.closedTrades));
  await expect(figure(page, "Winning")).toHaveText(String(m.wins));
  await expect(figure(page, "Losing")).toHaveText(String(m.losses));
  await expect(page.getByText(usd(m.netPnl), { exact: true }).first()).toBeVisible();
}

test("sample data loads, is labelled, and the figures match the API", async ({ page }) => {
  await loadSample(page);
  await expect(page.getByText("These figures include made-up sample trades.")).toBeVisible();
  const a = await analytics(page);
  expect(a.metrics.closedTrades).toBeGreaterThan(20);
  await expectFiguresMatch(page, a);

  // Without the sample switch the same screen shows only the user's own record.
  await page.getByRole("button", { name: "Hide sample data" }).click();
  await expect(page.getByRole("heading", { name: "Only sample trades so far" })).toBeVisible();
});

// The cumulative chart took the Tape's place: it reads a day under the pointer or arrow keys, opens it, and brushes a range.
const chart = (page: Page) => page.getByTestId("cumulative-chart");

test("cumulative chart: arrow keys read a day and Enter opens its journal", async ({ page }) => {
  await loadSample(page);
  const a = await analytics(page);
  const last = a.periods.day.at(-1);
  await chart(page).focus();
  const tip = page.getByTestId("cumulative-card").locator("figcaption");
  const mmddyy = (k: string) => `${k.slice(5, 7)}/${k.slice(8, 10)}/${k.slice(2, 4)}`;
  await expect(tip).toContainText(mmddyy(last.key));
  await page.keyboard.press("ArrowLeft");
  await expect(tip).toContainText(mmddyy(a.periods.day.at(-2).key));
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/day\?.*date=${last.key}`));
});

test("cumulative chart: dragging zooms to those days, and Reset zoom removes it", async ({ page }) => {
  await loadSample(page);
  const all = await analytics(page);
  await expectFiguresMatch(page, all);
  const box = (await chart(page).boundingBox())!;
  const y = box.y + box.height / 2;
  const refetch = page.waitForResponse((res) => res.url().includes("/api/analytics?") && res.url().includes("from="));
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
  await page.mouse.up();
  await expect(page).toHaveURL(/range=custom/);
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  const filtered = await (await refetch).json();
  expect(filtered.metrics.closedTrades).toBeLessThan(all.metrics.closedTrades);
  await expectFiguresMatch(page, filtered);

  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(page).not.toHaveURL(/range=|from=|to=/);
  await expect(page).toHaveURL(/includeSample=1/);
  await expectFiguresMatch(page, all);
});
