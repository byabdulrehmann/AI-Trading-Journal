import type { Page } from "@playwright/test";
import { dialog, expect, importCsv, loadSample, open, row, test } from "./helpers";

const usdSigned = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sampleClosedTrade(page: Page, withFills = false) {
  const { trades } = await (await page.request.get("/api/trades?includeSample=1&closedOnly=1&pageSize=200")).json();
  if (!withFills) return trades[0];
  for (const t of trades) {
    const full = (await (await page.request.get(`/api/trades/${t.id}`)).json()).trade;
    if (full.executions.length > 2) return full;
  }
  throw new Error("no scaled trade in the sample");
}

test("a real trade with no connection says why there's no chart, and invents nothing", async ({ page }) => {
  await importCsv(page, ["EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1,1.11,1000,1.09,,0"]);
  await open(page, "/journal");
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  const chart = dialog(page).getByTestId("trade-chart");
  await expect(chart.getByTestId("no-prices")).toContainText("none is connected");
  await expect(chart.getByTestId("candle-chart")).toHaveCount(0);
  await expect(chart.getByRole("link", { name: "Replay this trade" })).toHaveCount(0);
  const t = (await (await page.request.get("/api/trades")).json()).trades[0];
  const res = await (await page.request.get(`/api/trades/${t.id}/bars`)).json();
  expect([res.source, res.bars.length]).toEqual([null, 0]);
  expect(t.mae).toBeNull();
});

test("a sample trade shows a chart, labelled as simulated, and MAE and MFE", async ({ page }) => {
  await loadSample(page);
  const t = await sampleClosedTrade(page);
  await open(page, "/journal?includeSample=1");
  await page.locator(`#trade-row-${t.id}`).getByRole("button", { name: t.symbol }).click();
  const chart = dialog(page).getByTestId("trade-chart");
  await expect(chart.getByTestId("candle-chart").locator("canvas").first()).toBeVisible();
  await expect(chart.getByText("Simulated")).toBeVisible();
  await expect(chart.getByText(/Made-up prices/)).toBeVisible();
  await expect(chart.getByTestId("excursions")).toContainText("Best");
  const saved = (await (await page.request.get(`/api/trades/${t.id}`)).json()).trade;
  expect(saved.mae).not.toBeNull();
  expect(saved.mfe).not.toBeNull();
  expect(saved.mae).toBeGreaterThanOrEqual(0);
});

test("replaying a scaled trade: it steps, plays, and ends on the trade's own gross result", async ({ page }) => {
  await loadSample(page);
  const t = await sampleClosedTrade(page, true);
  await open(page, `/replay?trade=${t.id}&includeSample=1`);
  await expect(page.getByTestId("candle-chart").locator("canvas").first()).toBeVisible();
  await expect(page.getByText("Simulated")).toBeVisible();

  const bar = page.getByTestId("replay-bar");
  const realized = page.getByTestId("replay-realized");
  const size = page.getByTestId("replay-size");
  const number = async () => Number((await bar.textContent())!.split(" of ")[0]);
  await expect(size).toHaveText("Flat");
  await expect(realized).toHaveText("$0.00");

  const start = await number();
  await page.getByRole("button", { name: "Forward one bar" }).click();
  expect(await number()).toBe(start + 1);
  await page.getByRole("button", { name: "Back one bar" }).click();
  expect(await number()).toBe(start);

  // The first fill opens the position.
  await page.getByRole("button", { name: "Next fill" }).click();
  await expect(size).toHaveText(new RegExp(`^${t.side === "long" ? "Long" : "Short"} `));
  await expect(page.getByTestId("replay-fills").locator("li")).toHaveCount(1);

  // Playing moves on, faster at a higher speed, and pausing holds.
  const before = await number();
  await page.getByRole("radiogroup", { name: "Replay speed" }).getByRole("radio", { name: "10x" }).click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(number).toBeGreaterThan(before + 2);
  await page.getByRole("button", { name: "Pause" }).click();
  const held = await number();
  await page.waitForTimeout(400);
  expect(await number()).toBe(held);

  await page.getByRole("button", { name: "Jump to the end" }).click();
  await expect(size).toHaveText("Flat");
  await expect(page.getByTestId("replay-fills").locator("li")).toHaveCount(t.executions.length);
  await expect(realized).toHaveText(usdSigned(t.grossPnl));
  await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();

  await page.getByRole("button", { name: "Back to the start" }).click();
  await expect(size).toHaveText("Flat");
  await expect(realized).toHaveText("$0.00");
});

test("keyboard: space plays and pauses, arrows step", async ({ page }) => {
  await loadSample(page);
  const t = await sampleClosedTrade(page);
  await open(page, `/replay?trade=${t.id}&includeSample=1`);
  const bar = page.getByTestId("replay-bar");
  await expect(bar).toBeVisible();
  const number = async () => Number((await bar.textContent())!.split(" of ")[0]);
  const start = await number();
  await page.keyboard.press("ArrowRight");
  await expect.poll(number).toBe(start + 1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(number).toBe(start);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

test("replaying a day: every trade in the instrument, ending on their combined gross", async ({ page }) => {
  await loadSample(page);
  const { days } = await (await page.request.get("/api/daily?includeSample=1")).json();
  // Find a day with trades.
  let picked: { date: string; body: { symbols: string[]; symbol: string; trades: { grossPnl: number }[] } } | null = null;
  for (const d of days) {
    const body = await (await page.request.get(`/api/replay/day?date=${d.date}&includeSample=1`)).json();
    if (body.trades.length && body.bars.length) {
      picked = { date: d.date, body };
      break;
    }
  }
  expect(picked).not.toBeNull();
  const { date, body } = picked!;
  await open(page, `/replay?day=${date}&includeSample=1&symbol=${encodeURIComponent(body.symbol)}`);
  await expect(page.getByTestId("candle-chart").locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Jump to the end" }).click();
  const total = body.trades.reduce((n, t) => n + t.grossPnl, 0);
  await expect(page.getByTestId("replay-realized")).toHaveText(usdSigned(Math.round(total * 100) / 100));
  await expect(page.getByTestId("linked-notes")).toBeVisible();
  if (body.symbols.length > 1) {
    await page.getByLabel("Instrument").selectOption(body.symbols.find((s) => s !== body.symbol)!);
    await expect(page).toHaveURL(/symbol=/);
    await expect(page.getByTestId("replay-bar")).toBeVisible();
  }
});

test("reaching replay: the chooser, a day with nothing, and the daily journal's link", async ({ page }) => {
  await loadSample(page);
  await open(page, "/replay?includeSample=1");
  await expect(page.getByTestId("replay-trades").locator("li").first()).toBeVisible();
  await page.getByTestId("replay-trades").getByRole("link").first().click();
  await expect(page).toHaveURL(/trade=\d+/);
  await expect(page.getByTestId("replay-bar")).toBeVisible();

  await open(page, "/replay?day=2020-01-01&includeSample=1");
  await expect(page.getByTestId("no-prices")).toContainText("No trades opened on this day");

  await open(page, "/day?date=2026-10-14&includeSample=1");
  await page.getByRole("link", { name: "Replay this day" }).click();
  await expect(page).toHaveURL(/\/replay\?day=2026-10-14/);
});

test("reports: reading prices fills MAE and MFE, and the figures match by recount", async ({ page }) => {
  await loadSample(page);
  await open(page, "/analytics?includeSample=1&tab=risk&accountId=");
  const before = await (await page.request.get("/api/analytics?includeSample=1")).json();
  expect(before.report.unread).toBeGreaterThan(0);
  // A narrow filter keeps this quick: one instrument's trades.
  const symbol = before.breakdowns.symbol.at(-1).key;
  await open(page, `/analytics?includeSample=1&tab=risk&symbol=${encodeURIComponent(symbol)}`);
  await page.getByRole("button", { name: "Read prices for them" }).click();
  await expect(page.getByText(/^Read \d+\.$/)).toBeVisible({ timeout: 60_000 });
  const a = await (await page.request.get(`/api/analytics?includeSample=1&symbol=${encodeURIComponent(symbol)}`)).json();
  expect(a.report.unread).toBe(0);
  expect(a.report.excursions.sample).toBe(a.metrics.closedTrades);
  await expect(page.getByTestId("excursion-report")).toContainText(`${a.report.excursions.sample} trades with prices and a stop`);
});
