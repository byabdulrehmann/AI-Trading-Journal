import { dialog, expect, loadSample, open, test } from "./helpers";

test("with no MT5 connection, a new session says why and nothing is made", async ({ page, guard }) => {
  guard.allow(/status of 422/);
  await open(page, "/backtest");
  await expect(page.getByText("No backtests yet")).toBeVisible();
  await page.getByRole("button", { name: "New session" }).first().click();
  const d = dialog(page);
  await d.getByLabel("Name").fill("Gold test");
  await d.getByLabel("Instrument").fill("XAUUSD");
  await expect(d.getByTestId("bar-estimate")).toContainText("bars");
  await d.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText(/none is connected/)).toBeVisible();
  const { sessions } = await (await page.request.get("/api/backtests")).json();
  expect(sessions).toEqual([]);
});

test("the sample session: trade it bar by bar, and its results stay out of live figures", async ({ page, guard }) => {
  guard.allow(/status of 422/);
  await loadSample(page);
  const live = (await (await page.request.get("/api/analytics?includeSample=1")).json()).metrics.closedTrades;
  await open(page, "/backtest");
  await page.getByRole("link", { name: "See the sample session" }).click();
  await page.getByRole("link", { name: /Sample backtest/ }).click();
  await expect(page.getByText(/made-up prices/)).toBeVisible();
  await expect(page.getByTestId("candle-chart").locator("canvas").first()).toBeVisible();
  const before = Number(await page.getByTestId("bt-stats").locator("dd").nth(1).innerText());
  expect(before).toBeGreaterThan(0);

  // A stop on the wrong side is refused, with the reason.
  const ticket = page.getByRole("form", { name: "Order ticket" });
  const price = Number(await page.getByTestId("bt-price").innerText());
  await ticket.getByLabel("Stop").fill(String(price + 0.01));
  await ticket.getByRole("button", { name: /^Buy at/ }).click();
  await expect(page.getByText(/stop must be below/)).toBeVisible();

  await ticket.getByLabel("Stop").fill("");
  await ticket.getByLabel("Size").fill("10000");
  await ticket.getByRole("button", { name: /^Buy at/ }).click();
  await expect(page.getByTestId("bt-open")).toContainText(`long 10000 at ${price}`, { ignoreCase: true });

  const clock = await page.getByTestId("bt-clock").innerText();
  await page.getByRole("button", { name: "Next bar" }).click();
  await expect(page.getByTestId("bt-clock")).not.toHaveText(clock);
  await page.getByTestId("bt-open").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("bt-open")).toHaveCount(0);
  await expect(page.getByTestId("bt-closed").locator("li").first()).toContainText("Closed by hand");
  await expect(page.getByTestId("bt-stats").locator("dd").nth(1)).toHaveText(String(before + 1));

  // Live figures, sample included, didn't change; the session's report has the new trade.
  expect((await (await page.request.get("/api/analytics?includeSample=1")).json()).metrics.closedTrades).toBe(live);
  await page.getByRole("link", { name: "Full report" }).click();
  await expect(page).toHaveURL(/analytics\?accountId=\d+/);
  await expect(page.getByRole("combobox", { name: "Account" }).locator("option:checked")).toHaveText("Sample backtest: EURUSD breakouts (backtest) (sample)");
});

test("the page never receives a bar past the session's position", async ({ page }) => {
  await loadSample(page);
  const { sessions } = await (await page.request.get("/api/backtests?includeSample=1")).json();
  const view = await (await page.request.get(`/api/backtests/${sessions[0].id}`)).json();
  const cursor = Date.parse(view.session.cursor) / 1000;
  expect(view.bars.at(-1).t).toBe(cursor);
  expect(view.bars.every((b: { t: number }) => b.t <= cursor)).toBe(true);
  expect(view.atEnd).toBe(false);
});

test("a backtest trade can't be moved into a live account, or a trade added to a session by hand", async ({ page }) => {
  await loadSample(page);
  const { sessions } = await (await page.request.get("/api/backtests?includeSample=1")).json();
  const view = await (await page.request.get(`/api/backtests/${sessions[0].id}`)).json();
  const t = view.trades[0];
  const { accounts } = await (await page.request.get("/api/accounts")).json();
  const liveAccount = accounts.find((a: { source: string; isSample: boolean }) => a.source !== "backtest" && a.isSample);
  const moved = await page.request.put(`/api/trades/${t.id}`, { data: { ...t, executions: null, accountId: liveAccount.id } });
  expect(moved.status()).toBe(422);
  const added = await page.request.post("/api/trades", { data: { accountId: sessions[0].accountId, symbol: "EURUSD", side: "long", openedAt: "2026-01-05T10:00:00.000Z", entryPrice: 1.1, quantity: 1 } });
  expect(added.status()).toBe(422);
  expect((await page.request.post(`/api/trades/${t.id}`)).status()).toBe(422);
});
