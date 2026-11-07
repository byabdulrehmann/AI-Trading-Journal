import type { Page } from "@playwright/test";
import { expect, importCsv, loadSample, open, test, usd } from "./helpers";

// By hand. Longs: +10, -5. Shorts: +20. Stops on all: risk 10 each.
const SET = [
  "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1000,1.1100,1000,1.0900,,0",
  "EURUSD,buy,2026-10-15 09:00,2026-10-15 10:00,1.1000,1.0950,1000,1.0900,,0",
  "GBPUSD,sell,2026-10-14 11:00,2026-10-14 12:00,1.3000,1.2800,1000,1.3100,,0",
];

const tab = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Report" }).getByRole("radio", { name });
const api = async (page: Page, query = "includeSample=1") => (await page.request.get(`/api/analytics?${query}`)).json();

test("every tab opens from the bar, stays in the URL, and shows its own report", async ({ page }) => {
  await loadSample(page);
  await open(page, "/analytics?includeSample=1");
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  const expected: [string, string, RegExp][] = [
    ["Day and time", "When you trade", /tab=time/],
    ["Instruments", "Instruments", /tab=instruments/],
    ["Playbooks", "Strategies", /tab=playbooks/],
    ["Behaviour", "Mistakes", /tab=behaviour/],
    ["Risk", "Risk taken", /tab=risk/],
    ["Wins and losses", "Winning and losing trades", /tab=wins/],
    ["Compare", "Side by side", /tab=compare/],
  ];
  for (const [name, heading, url] of expected) {
    await tab(page, name).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
  }
  await page.reload();
  await expect(tab(page, "Compare")).toHaveAttribute("aria-checked", "true");
  await tab(page, "Overview").click();
  await expect(page).not.toHaveURL(/tab=/);
  await expect(page.getByRole("heading", { name: "Equity curve" })).toBeVisible();
});

test("wins and losses, streaks and risk match the hand-worked figures", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/analytics?tab=wins");
  const table = page.getByTestId("win-loss");
  await expect(table.getByRole("row", { name: /^Trades/ })).toContainText("2");
  await expect(table.getByRole("row", { name: /^Total/ })).toContainText("+$30.00");
  await expect(table.getByRole("row", { name: /^Total/ })).toContainText(usd(-5));
  await expect(table.getByRole("row", { name: /^Largest/ })).toContainText("+$20.00");

  // In closing order: +10, +20, -5.
  const streaks = page.getByTestId("streaks");
  await expect(streaks.getByRole("row", { name: /^1/ })).toContainText("1");
  await expect(streaks.getByRole("row", { name: /^2/ })).toContainText("1");

  await open(page, "/analytics?tab=risk");
  const risk = page.getByTestId("risk-report");
  await expect(risk).toContainText("3 of 3, 100%");
  await expect(risk).toContainText("$10.00"); // 0.01 x 1000 for each
  await expect(risk).toContainText("+0.83R"); // (1 + 2 - 0.5) / 3
});

test("a link from a tab opens the journal without the tab", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/analytics?tab=instruments");
  await page.locator('tr[data-row="GBPUSD"]').getByRole("link", { name: "GBPUSD" }).click();
  await expect(page).toHaveURL(/\/journal\?.*symbol=GBPUSD/);
  await expect(page).not.toHaveURL(/tab=/);
});

test("compare: long against short, by hand, and a comparison can be reopened", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/analytics?tab=compare");
  await page.getByRole("button", { name: "Long against short" }).click();
  await expect(page).toHaveURL(/a\.side=long/);
  await expect(page).toHaveURL(/b\.side=short/);

  const table = page.getByTestId("compare-table");
  const row = (key: string) => table.locator(`[data-row="${key}"]`);
  await expect(row("netPnl")).toContainText("$5.00"); // 10 - 5
  await expect(row("netPnl")).toContainText("$20.00");
  await expect(row("netPnl")).toContainText("−$15.00");
  await expect(row("closedTrades")).toContainText("2");
  await expect(row("winRate")).toContainText("50.0%");
  await expect(row("winRate")).toContainText("100.0%");
  await expect(row("winRate")).toContainText("−50.0 pts");
  await expect(page.getByRole("img", { name: /Group A equity/ })).toBeVisible();

  await page.reload();
  await expect(table.locator('[data-row="netPnl"]')).toContainText("−$15.00");
  await expect(page.getByLabel("Group A: Direction")).toHaveValue("long");
});

test("compare: groups are set by hand, sit on top of the filter bar, and clear", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/analytics?tab=compare&symbol=EURUSD");
  await page.getByLabel("Group A: from", { exact: true }).fill("2026-10-14");
  await page.getByLabel("Group A: to", { exact: true }).fill("2026-10-14");
  await page.getByLabel("Group B: from", { exact: true }).fill("2026-10-15");
  await page.getByLabel("Group B: to", { exact: true }).fill("2026-10-15");
  const row = page.getByTestId("compare-table").locator('[data-row="netPnl"]');
  // EURUSD only, from the bar: +10 on the 14th, GBPUSD's +20 left out, and -5 on the 15th.
  await expect(row).toContainText("$10.00");
  await expect(row).toContainText("−$5.00");
  await expect(row).toContainText("+$15.00");

  await page.getByRole("button", { name: "Clear groups" }).click();
  await expect(page).not.toHaveURL(/a\.from/);
  await expect(page.getByText("Both groups are the same until you narrow one.")).toBeVisible();
});

test("compare holds up with the sample journal: groups add up to the whole", async ({ page }) => {
  await loadSample(page);
  const [whole, long, short] = await Promise.all([api(page), api(page, "includeSample=1&side=long"), api(page, "includeSample=1&side=short")]);
  expect(long.metrics.closedTrades + short.metrics.closedTrades).toBe(whole.metrics.closedTrades);
  expect(Math.abs(long.metrics.netPnl + short.metrics.netPnl - whole.metrics.netPnl)).toBeLessThan(0.01);
  await open(page, "/analytics?includeSample=1&tab=compare&a.side=long&b.side=short");
  await expect(page.getByTestId("compare-table").locator('[data-row="closedTrades"]')).toContainText(String(long.metrics.closedTrades));
  await expect(page.getByTestId("compare-table").locator('[data-row="closedTrades"]')).toContainText(String(short.metrics.closedTrades));
});

test("every breakdown in the API adds up to the closed trades it reports on", async ({ page }) => {
  await loadSample(page);
  const a = await api(page);
  const total = a.metrics.closedTrades;
  const sum = (rows: { trades: number }[]) => rows.reduce((n, r) => n + r.trades, 0);
  for (const key of ["symbol", "side", "session", "weekday", "hour", "month", "plan", "account", "assetClass", "hold", "price", "size", "heatmap"]) expect(sum(a.breakdowns[key]), key).toBe(total);
  const runs = a.report.streaks.reduce((n: number, r: { length: number; wins: number }) => n + r.length * r.wins, 0);
  expect(runs).toBe(a.metrics.wins);
});

test("a filtered report that matches nothing says so, and Compare still opens", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/analytics?symbol=XAUUSD");
  await expect(page.getByRole("heading", { name: "No closed trades match" })).toBeVisible();
  await tab(page, "Compare").click();
  await expect(page.getByTestId("compare-table")).toBeVisible();
});
