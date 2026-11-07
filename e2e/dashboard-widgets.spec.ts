import type { Page } from "@playwright/test";
import { expect, figure, loadSample, open, test } from "./helpers";

const widgets = (page: Page) => page.locator("[data-widget]").evaluateAll((els) => els.map((e) => e.getAttribute("data-widget")));
const reset = (page: Page) => page.request.patch("/api/settings", { data: { dashboard: null } });
const api = async (page: Page, query = "includeSample=1") => (await page.request.get(`/api/analytics?${query}`)).json();
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);
const oneTrade = async (page: Page) => {
  const account = (await (await page.request.get("/api/accounts")).json()).accounts[0].id;
  await page.request.post("/api/trades", { data: { accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-07-01T02:30:00.000Z", closedAt: "2026-07-01T03:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000 } });
};

test("the score shows the API's total, and its axes open their formulas", async ({ page }) => {
  await loadSample(page);
  const a = await api(page);
  expect(a.score.score).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("score-total")).toHaveText(String(a.score.score));
  const card = page.locator('[data-widget="score"]');
  await expect(card.getByRole("img", { name: new RegExp(`Score ${a.score.score} of 100`) })).toBeVisible();
  await card.getByRole("button", { name: "formula for Profitability" }).click();
  await expect(card.getByText(/profit factor: 0\.5 = 0/)).toBeVisible();
});

test("with too few trades the score says what it needs instead of a number", async ({ page }) => {
  await oneTrade(page);
  await open(page, "/");
  await expect(page.getByTestId("score-pending")).toContainText("at least 20 closed trades across 5 days");
  await expect(page.getByTestId("score-total")).toHaveCount(0);
});

test("customizing: add, remove, resize, move and drag, kept after a reload", async ({ page }) => {
  await loadSample(page);
  await expect.poll(() => widgets(page)).toContain("tape");
  try {
    await page.getByRole("button", { name: "Customize" }).click();

    await page.getByLabel("Add a widget").selectOption("mistakes");
    await expect(page.locator('[data-widget="mistakes"]').getByRole("heading", { name: "Mistakes" })).toBeVisible();

    await page.getByRole("button", { name: "Remove Worth a look" }).click();
    await expect(page.locator('[data-widget="worth"]')).toHaveCount(0);

    const before = await widgets(page);
    expect(before.indexOf("quality")).toBe(before.indexOf("result") + 1);
    await page.getByRole("button", { name: "Move Quality earlier" }).click();
    await expect.poll(async () => (await widgets(page)).indexOf("quality")).toBe(before.indexOf("result"));

    // A real drag, to a widget in view: recent lands where calendar was.
    const handle = page.getByTestId("drag-recent");
    await handle.scrollIntoViewIfNeeded();
    const from = (await handle.boundingBox())!;
    const slot = (await widgets(page)).indexOf("calendar");
    await page.mouse.move(from.x + 5, from.y + from.height / 2);
    await page.mouse.down();
    // The bottom of the widget above, which is on screen even when its top has scrolled away.
    const to = (await page.locator('[data-widget="calendar"]').boundingBox())!;
    await page.mouse.move(to.x + 20, to.y + to.height - 10, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await widgets(page)).indexOf("recent")).toBe(slot);

    await page.getByLabel("Size of Risk").selectOption("4");
    await expect(page.locator('[data-widget="risk"]')).toHaveClass(/xl:col-span-4/);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "Remove Risk" })).toHaveCount(0);

    await page.reload();
    await expect.poll(async () => (await widgets(page)).indexOf("recent")).toBe(slot);
    const after = await widgets(page);
    expect(after).toContain("mistakes");
    expect(after).not.toContain("worth");
    await expect(page.locator('[data-widget="risk"]')).toHaveClass(/xl:col-span-4/);
  } finally {
    await reset(page);
  }
});

test("saved views: separate layouts, renamed, switched and deleted", async ({ page }) => {
  await loadSample(page);
  const view = page.getByLabel("Dashboard view");
  try {
    await page.getByRole("button", { name: "Customize" }).click();
    await page.getByLabel("Save as a new view").fill("Risk review");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(view.locator("option:checked")).toHaveText("Risk review");

    await page.getByRole("button", { name: "Remove Equity tape" }).click();
    await expect(page.locator('[data-widget="tape"]')).toHaveCount(0);

    // A taken name is refused.
    await page.getByLabel("Save as a new view").fill("overview");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByText("Pick a name that isn't taken. You can keep up to 10 views.")).toBeVisible();
    await page.getByLabel("Save as a new view").fill("");

    await view.selectOption({ label: "Overview" });
    await expect(page.locator('[data-widget="tape"]')).toHaveCount(1);
    await view.selectOption({ label: "Risk review" });
    await expect(page.locator('[data-widget="tape"]')).toHaveCount(0);

    const rename = page.getByLabel("Rename this view");
    await rename.fill("Risk");
    await rename.press("Enter");
    await expect(view.locator("option:checked")).toHaveText("Risk");

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete view" }).click();
    await expect(view.locator("option:checked")).toHaveText("Overview");
    await expect(page.getByRole("button", { name: "Delete view" })).toBeDisabled();

    await page.getByRole("button", { name: "Remove Score" }).click();
    await expect(page.locator('[data-widget="score"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Reset layout" }).click();
    await expect(page.locator('[data-widget="score"]')).toHaveCount(1);
  } finally {
    await reset(page);
  }
});

test("results in R and percent match the API on the screen, and the score doesn't move", async ({ page }) => {
  await loadSample(page);
  const money = await api(page);

  await page.getByLabel("Show results in").selectOption("r");
  await expect(page).toHaveURL(/unit=r/);
  const inR = await api(page, "includeSample=1&unit=r");
  expect(inR.display).toBe("R");
  expect(inR.metrics.closedTrades).toBe(money.metrics.closedTrades); // Every sample trade has a stop.
  const net = `${inR.metrics.netPnl < 0 ? "−" : "+"}${Math.abs(inR.metrics.netPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`;
  await expect(page.locator('[data-widget="result"]').getByText(net, { exact: true })).toBeVisible();
  expect(inR.score.score).toBe(money.score.score);
  await expect(page.getByTestId("score-total")).toHaveText(String(money.score.score));

  await page.getByLabel("Show results in").selectOption("percent");
  const inPct = await api(page, "includeSample=1&unit=percent");
  expect(inPct.display).toBe("%");
  near(inPct.metrics.netPnl, (money.metrics.netPnl / 115000) * 100); // 25,000 + 40,000 + 50,000 of starting balances
  await expect(page.getByTestId("unit-note")).toContainText("115,000 combined starting balance");

  // The unit follows you to the other result pages.
  await page.getByRole("navigation").getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/unit=percent/);
  await expect(figure(page, "Net P&L")).toContainText("%");
});

test("a unit nothing can be shown in falls back to money and says why", async ({ page }) => {
  await oneTrade(page);
  await open(page, "/?unit=percent");
  await expect(page.getByTestId("unit-note")).toContainText("Showing money");
  await expect(page.getByTestId("unit-note")).toContainText("no starting balance");
  await expect(page.locator('[data-widget="result"]').getByText("+$10.00", { exact: true }).first()).toBeVisible();
});

test("the small calendar's day links match the API", async ({ page }) => {
  await loadSample(page);
  const a = await api(page);
  const last = a.periods.day.at(-1);
  const cell = page.getByTestId("mini-calendar").getByRole("link", { name: new RegExp(`^${last.key}: `) });
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?.*day=${last.key}`));
});
