import { dialog, expect, figure, loadSample, test, usd, r } from "./helpers";
import type { Page } from "@playwright/test";

const tape = (page: Page) => page.getByRole("slider", { name: /Closed trades in order/ });
const tradeInDrawer = (page: Page, id: number | string) => dialog(page).getByRole("heading", { name: new RegExp(`trade #${id}$`) });

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

test("the Tape: scrubbing reads a trade and clicking opens it", async ({ page }) => {
  await loadSample(page);
  const box = (await tape(page).boundingBox())!;
  const { equity } = await analytics(page);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tape(page)).toHaveAttribute("aria-valuetext", /^Trade #\d+/);
  const text = (await tape(page).getAttribute("aria-valuetext"))!;
  const id = Number(/#(\d+)/.exec(text)![1]);
  const at = equity.findIndex((p: { tradeId: number }) => p.tradeId === id);
  expect(at).toBeGreaterThanOrEqual(0);
  // The readout's net is the step this trade made in the equity line, and its equity is the line itself.
  const net = Math.round((equity[at].equity - (at ? equity[at - 1].equity : 0)) * 100) / 100;
  await expect(page.locator("p > span.num", { hasText: new RegExp(`^#${id}$`) })).toBeVisible();
  await expect(tape(page)).toHaveAttribute("aria-valuetext", new RegExp(`net ${usd(net).replace("+", "\\+").replace("$", "\\$")}, equity ${usd(equity[at].equity).replace("+", "\\+").replace("$", "\\$")}$`));

  // Scrubbing elsewhere names a different trade.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await expect(tape(page)).not.toHaveAttribute("aria-valuetext", text);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tape(page)).toHaveAttribute("aria-valuetext", text);

  await page.mouse.down();
  await page.mouse.up();
  await expect(tradeInDrawer(page, id)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  await page.mouse.move(2, 2);
  await expect(tape(page)).toHaveAttribute("aria-valuetext", "No trade chosen");
});

test("the Tape: arrow keys step through trades and Enter opens", async ({ page }) => {
  await loadSample(page);
  const { equity } = await analytics(page);
  const n = equity.length;

  await tape(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tape(page)).toHaveAttribute("aria-valuenow", "1");
  await expect(tape(page)).toHaveAttribute("aria-valuetext", new RegExp(`^Trade #${equity[0].tradeId},`));
  await page.keyboard.press("ArrowRight");
  await expect(tape(page)).toHaveAttribute("aria-valuenow", "2");
  await page.keyboard.press("ArrowLeft");
  await expect(tape(page)).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("End");
  await expect(tape(page)).toHaveAttribute("aria-valuenow", String(n));
  await page.keyboard.press("ArrowRight");
  await expect(tape(page)).toHaveAttribute("aria-valuenow", String(n));
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(tape(page)).toHaveAttribute("aria-valuetext", new RegExp(`^Trade #${equity[1].tradeId},`));

  await page.keyboard.press("Enter");
  await expect(tradeInDrawer(page, equity[1].tradeId)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  await tape(page).focus();
  await page.keyboard.press("Escape");
  await expect(tape(page)).toHaveAttribute("aria-valuetext", "No trade chosen");
});

test("the Tape: dragging brushes a date range, and Clear range removes it", async ({ page }) => {
  await loadSample(page);
  const all = await analytics(page);
  await expectFiguresMatch(page, all);
  const box = (await tape(page).boundingBox())!;
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  const live = page.getByText("Release to filter to these days.");
  await expect(live).toBeVisible();
  const brushed = Number((await page.locator("p", { has: live }).or(live).first().textContent())!.match(/\d+/)![0]);
  expect(brushed).toBeGreaterThan(0);

  const refetch = page.waitForResponse((res) => res.url().includes("/api/analytics?") && res.url().includes("from="));
  await page.mouse.up();
  await expect(page).toHaveURL(/range=custom/);
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/to=\d{4}-\d{2}-\d{2}/);
  await expect(dialog(page)).toHaveCount(0);

  const filtered = await (await refetch).json();
  expect(filtered.metrics.closedTrades).toBeLessThan(all.metrics.closedTrades);
  expect(filtered.metrics.closedTrades).toBeGreaterThanOrEqual(brushed);
  await expectFiguresMatch(page, filtered);

  await page.reload();
  await expectFiguresMatch(page, filtered);

  await page.getByRole("button", { name: "Clear range" }).click();
  await expect(page).not.toHaveURL(/range=|from=|to=/);
  await expect(page).toHaveURL(/includeSample=1/);
  await expect(page.getByRole("button", { name: "Clear range" })).toHaveCount(0);
  await expectFiguresMatch(page, all);
});
