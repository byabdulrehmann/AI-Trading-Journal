import type { Page } from "@playwright/test";
import { dialog, expect, open, test } from "./helpers";

/**
 * PART 26.13: the dashboard against trades whose figures are worked out here by hand.
 *
 * USD, in UTC:
 *   Main    AAPL  Breakout  closes 2026-07-06 14:00  +50
 *   Main    MSFT  Fade      closes 2026-07-06 16:00  -20
 *   Main    AAPL  Breakout  closes 2026-07-08        +30
 *   Second  MSFT  Fade      closes 2026-07-09        -10
 *   Second  AAPL  Breakout  closes 2026-07-14        +40
 *   Main    TSLA  open
 * EUR: Euro AAPL +100, closes 2026-07-07.
 *
 * Net $90 over 5 closed trades: 3 won, 2 lost, win rate 60%. Profit factor 120 / 30 = 4.00. Average win 40, average
 * loss -15, ratio 2.67. Days: 6th +30, 8th +30, 9th -10, 14th +40, so 3 of 4 won (75%). Sunday weeks of July 2026:
 * row 2 (5th to 11th) +50 over 3 days, row 3 (12th to 18th) +40 over 1 day.
 */
async function seed(page: Page) {
  expect((await page.request.patch("/api/settings", { data: { timeZone: "UTC" } })).ok()).toBe(true);
  for (const [name, currency] of [["Second", "USD"], ["Euro", "EUR"]]) expect((await page.request.post("/api/accounts", { data: { name, currency } })).ok()).toBe(true);
  const accounts = (await (await page.request.get("/api/accounts")).json()).accounts as { id: number; name: string }[];
  const id = (name: string) => accounts.find((a) => a.name === (name === "Main" ? "Main account" : name))!.id;
  const trade = async (account: string, symbol: string, strategy: string, closedAt: string | null, pnl: number) => {
    const opened = closedAt ? new Date(Date.parse(closedAt) - 30 * 60_000).toISOString() : "2026-07-15T10:00:00.000Z";
    const res = await page.request.post("/api/trades", { data: { accountId: id(account), symbol, side: "long", strategy, openedAt: opened, closedAt, entryPrice: 100, exitPrice: closedAt ? 100 + pnl : null, quantity: 1 } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()).trade.id as number;
  };
  await trade("Main", "AAPL", "Breakout", "2026-07-06T14:00:00.000Z", 50);
  await trade("Main", "MSFT", "Fade", "2026-07-06T16:00:00.000Z", -20);
  await trade("Main", "AAPL", "Breakout", "2026-07-08T14:00:00.000Z", 30);
  await trade("Second", "MSFT", "Fade", "2026-07-09T14:00:00.000Z", -10);
  await trade("Second", "AAPL", "Breakout", "2026-07-14T14:00:00.000Z", 40);
  await trade("Euro", "AAPL", "Breakout", "2026-07-07T14:00:00.000Z", 100);
  return { open: await trade("Main", "TSLA", "Breakout", null, 0) };
}

const restore = (page: Page) => page.request.patch("/api/settings", { data: { timeZone: "" } });
const net = (page: Page) => page.getByTestId("kpi-net-value");

async function toJuly(page: Page) {
  const title = page.getByTestId("calendar-month");
  for (let i = 0; i < 36 && (await title.textContent()) !== "July 2026"; i++) {
    const [y, m] = ((await title.textContent()) ?? "").split(" ").reverse();
    const later = Number(y) * 12 + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(m) > 2026 * 12 + 6;
    await page.getByRole("button", { name: later ? "Previous month" : "Next month" }).click();
  }
  await expect(title).toHaveText("July 2026");
}

test("26.13 1, 6, 14: the five KPIs, the cumulative line and the currency are worked out from the trades", async ({ page }) => {
  try {
    await seed(page);
    await open(page, "/");
    await expect(net(page)).toHaveText("$90.00");
    await expect(page.getByTestId("kpi-net-count")).toHaveText("5");
    await expect(page.getByTestId("kpi-winrate-value")).toHaveText("60.00%");
    await expect(page.getByTestId("kpi-winrate").getByRole("img")).toHaveAccessibleName("3 won, 0 breakeven, 2 lost");
    await expect(page.getByTestId("kpi-pf-value")).toHaveText("4.00");
    await expect(page.getByTestId("kpi-gross-profit")).toHaveText("$120.00");
    await expect(page.getByTestId("kpi-gross-loss")).toHaveText("−$30.00");
    await expect(page.getByTestId("kpi-daywin-value")).toHaveText("75.00%");
    await expect(page.getByTestId("kpi-avg-value")).toHaveText("2.67");

    // Cumulative P&L, checked against the trade list summed here, day by day.
    const trades = (await (await page.request.get("/api/trades?closedOnly=1&currency=USD&pageSize=100")).json()).trades as { pnl: number; closedAt: string }[];
    const byDay = new Map<string, number>();
    for (const t of trades) byDay.set(t.closedAt.slice(0, 10), (byDay.get(t.closedAt.slice(0, 10)) ?? 0) + t.pnl);
    const total = [...byDay.values()].reduce((a, b) => a + b, 0);
    expect([byDay.size, total]).toEqual([4, 90]);
    await expect(page.getByTestId("cumulative-chart")).toHaveAccessibleName("Cumulative realized P&L over 4 trading days, ending at $90.00.");
    await expect(page.getByTestId("daily-chart").locator("rect[data-bar]")).toHaveCount(4);

    // The EUR account is never added in: it has its own totals.
    await page.getByRole("button", { name: /^Currency for totals/ }).click();
    await page.getByTestId("currency-menu").getByRole("radio", { name: "EUR" }).click();
    await expect(net(page)).toHaveText("€100.00");
    await expect(page.getByTestId("kpi-net-count")).toHaveText("1");
  } finally {
    await restore(page);
  }
});

test("26.13 2, 3, 4, 5, 15: account, date, instrument and strategy filters change the figures, and survive a refresh", async ({ page }) => {
  try {
    await seed(page);
    await open(page, "/");
    await expect(net(page)).toHaveText("$90.00");

    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByTestId("account-menu").getByRole("radio", { name: /^Second/ }).click();
    await expect(net(page)).toHaveText("$30.00");
    await page.reload();
    await expect(net(page)).toHaveText("$30.00");
    await expect(page.getByRole("button", { name: "Account: Second" })).toBeVisible();
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByTestId("account-menu").getByRole("radio", { name: /^All Accounts/ }).click();
    await expect(net(page)).toHaveText("$90.00");

    await page.getByRole("button", { name: /^Date range/ }).click();
    await page.getByTestId("date-menu").getByLabel("From date").fill("2026-07-08");
    await page.getByTestId("date-menu").getByLabel("To date").fill("2026-07-10");
    await expect(net(page)).toHaveText("$20.00");
    await page.getByTestId("date-menu").getByRole("radio", { name: "All time" }).click();
    await expect(net(page)).toHaveText("$90.00");

    await page.getByRole("button", { name: /^Filters/ }).click();
    const menu = page.getByTestId("filters-menu");
    await expect(menu.getByLabel("Instrument").locator('option[value="MSFT"]')).toBeAttached();
    await menu.getByLabel("Instrument").selectOption("MSFT");
    await expect(net(page)).toHaveText("−$30.00");
    await menu.getByLabel("Instrument").selectOption("");
    await menu.getByLabel("Strategy").selectOption("Breakout");
    await expect(net(page)).toHaveText("$120.00");
    await expect(page.getByRole("button", { name: "Filters, 1 on" })).toBeVisible();
    await page.reload();
    await expect(net(page)).toHaveText("$120.00");
  } finally {
    await restore(page);
  }
});

test("26.13 7, 9, 10, 11, 15: calendar days match the daily bars, weeks add up, a day opens its journal, and the month is kept", async ({ page }) => {
  try {
    await seed(page);
    await open(page, "/");
    await toJuly(page);
    const cal = page.getByTestId("month-calendar");
    await expect(cal.getByTestId("month-pnl")).toHaveText("$90");
    await expect(cal.getByTestId("month-days")).toHaveText("4 days");

    // Each calendar day equals that day's bar from the same analytics response.
    const a = await (await page.request.get("/api/analytics")).json();
    for (const d of a.periods.day as { key: string; pnl: number; trades: number }[]) {
      const usd = `${d.pnl < 0 ? "−" : ""}$${Math.abs(d.pnl).toFixed(2)}`;
      await expect(cal.locator(`a[data-day="${d.key}"]`)).toHaveAccessibleName(new RegExp(`^${d.key}: ${usd.replace("$", "\\$")}, ${d.trades} trades?`));
    }
    expect(a.periods.day.map((d: { key: string; pnl: number }) => [d.key, d.pnl])).toEqual([["2026-07-06", 30], ["2026-07-08", 30], ["2026-07-09", -10], ["2026-07-14", 40]]);
    await expect(cal.locator('a[data-day="2026-07-06"]')).toContainText("2 trades");
    await expect(cal.locator('a[data-day="2026-07-06"]')).toContainText("50.0%");

    const weeks = cal.getByTestId("week-summary");
    await expect(weeks).toHaveCount(5); // July 2026 starts on a Wednesday
    await expect(weeks.nth(0)).toContainText("Week 1$00 days");
    await expect(weeks.nth(1)).toContainText("Week 2$503 days");
    await expect(weeks.nth(2)).toContainText("Week 3$401 day");

    await page.reload();
    await expect(page.getByTestId("calendar-month")).toHaveText("July 2026");

    await cal.locator('a[data-day="2026-07-08"]').click();
    await expect(page).toHaveURL(/\/day\?.*date=2026-07-08/);
  } finally {
    await restore(page);
  }
});

test("26.13 8, 12: trades and open positions open their details; a hand-entered position has no live price", async ({ page }) => {
  try {
    await seed(page);
    await open(page, "/");
    const card = page.getByTestId("trades-card");
    await expect(card.getByTestId("recent-trades").locator("tbody tr")).toHaveCount(5);
    await expect(card.getByTestId("recent-trades").locator("tbody tr").first()).toContainText("07/14/2026AAPL$40.00");
    await card.getByTestId("recent-trades").getByRole("button", { name: "AAPL" }).first().click();
    await expect(dialog(page)).toContainText("AAPL");
    await page.keyboard.press("Escape");

    await card.getByRole("tab", { name: /Open positions/ }).click();
    await expect(card.getByTestId("open-positions").locator("tbody tr")).toHaveCount(1);
    await expect(card.getByTestId("open-positions")).toContainText("TSLA");
    await expect(card.getByTestId("open-positions")).toContainText("Price unavailable");
    await expect(card.getByTestId("positions-status")).toContainText("Accounts entered by hand have no live price.");

    // More columns, kept after a refresh.
    await card.getByRole("button", { name: "Choose position columns" }).click();
    await page.getByLabel("Entry price").check();
    await page.getByLabel("Account", { exact: true }).check();
    await page.reload();
    await expect(card.getByRole("tab", { name: /Open positions/ })).toHaveAttribute("aria-selected", "true");
    await expect(card.getByTestId("open-positions")).toContainText("Main account");
    await card.getByTestId("open-positions").getByRole("button", { name: "TSLA" }).click();
    await expect(dialog(page)).toContainText("TSLA");
  } finally {
    await page.evaluate(() => localStorage.removeItem("jarvis-position-columns")).catch(() => {});
    await restore(page);
  }
});

test("26.13 13: empty states, and an empty filter result", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByText("Start your journal").or(page.getByText("No trades yet"))).toBeVisible();
  await expect(page.getByTestId("kpi-row")).toHaveCount(0);
  await expect(page.getByTestId("last-import")).toHaveText("never");
  await page.request.post("/api/trades", { data: { accountId: (await (await page.request.get("/api/accounts")).json()).accounts[0].id, symbol: "AAPL", side: "long", openedAt: "2026-07-06T13:30:00.000Z", closedAt: "2026-07-06T14:00:00.000Z", entryPrice: 100, exitPrice: 101, quantity: 1 } });
  await open(page, "/?symbol=NOPE");
  await expect(page.getByText("No trades match these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(net(page)).toHaveText("$1.00");
});

test("the sidebar collapses and stays collapsed, unbuilt modules are marked and not links, and the bell lists what needs attention", async ({ page }) => {
  await open(page, "/");
  const nav = page.getByRole("complementary", { name: "Primary" });
  for (const name of ["Mentor Mode", "University", "Resource Center"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);
  await expect(nav.getByTestId("nav-soon")).toHaveCount(3);
  await nav.getByRole("link", { name: "Trade Replay" }).click();
  await expect(page).toHaveURL(/\/replay/);
  await expect(page.getByTestId("page-title")).toHaveText("Trade Replay");

  await page.getByRole("button", { name: "Collapse the sidebar" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  expect((await nav.boundingBox())!.width).toBeLessThan(80);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-nav", "collapsed");
  await page.getByRole("button", { name: "Expand the sidebar" }).click();
  expect((await nav.boundingBox())!.width).toBeGreaterThan(150);

  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByTestId("notifications")).toContainText("Nothing needs your attention");

  await nav.getByRole("button", { name: "Add trade" }).click();
  await expect(dialog(page)).toBeVisible();
});
