import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { dialog, expect, figure, importCsv, loadSample, open, row, rows, test, usd } from "./helpers";

// By hand, all on Oct 14: +10 at 10:00, +20 at 12:00, -5 at 14:00 is +25. Oct 15: -5.
const SET = [
  "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1000,1.1100,1000,1.0900,,0",
  "GBPUSD,sell,2026-10-14 11:00,2026-10-14 12:00,1.3000,1.2800,1000,1.3100,,0",
  "EURUSD,buy,2026-10-14 13:00,2026-10-14 14:00,1.1000,1.0950,1000,1.0900,,0",
  "AUDUSD,buy,2026-10-15 09:00,2026-10-15 10:00,0.7000,0.6950,1000,0.6900,,0",
];

const settings = (page: Page, data: Record<string, unknown>) => page.request.patch("/api/settings", { data });

test("a day shows its figures, curve and trades, matching what was traded", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/day?date=2026-10-14");
  await expect(page.getByTestId("day-net")).toHaveText(`+${usd(25).replace("+", "")}`);
  await expect(page.getByRole("img", { name: /Net P&L through the day: 3 closed trades, ending at \+\$25\.00/ })).toBeVisible();
  await expect(figure(page, "Closed")).toHaveText("3");
  await expect(figure(page, "Profit factor")).toHaveText("6.00"); // 30 / 5
  await expect(page.getByTestId("day-trades").locator("ul > li")).toHaveCount(3);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(/date=2026-10-15/);
  await expect(page.getByTestId("day-net")).toHaveText(usd(-5));

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByTestId("day-empty")).toBeVisible();
  await expect(page.getByLabel("Pre-market plan")).toBeVisible();
});

test("plan, recap and rating save on their own, stay after a reload, and show in the list", async ({ page }) => {
  await open(page, "/day?date=2026-10-20");
  const plan = page.getByLabel("Pre-market plan");
  await plan.fill("Only trade the open.");
  await plan.blur();
  await expect(page.getByTestId("day-status")).toHaveText("Saved");

  await page.getByRole("radio", { name: "4", exact: true }).click();
  await expect(page.getByTestId("day-status")).toHaveText("Saved");

  const recap = page.getByLabel("End of day recap");
  await recap.fill("Stuck to it.");
  // Leaving the day without clicking elsewhere first must not lose it.
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(/date=2026-10-21/);
  await expect(page.getByLabel("End of day recap")).toHaveValue("");

  await open(page, "/day?date=2026-10-20");
  await expect(page.getByLabel("Pre-market plan")).toHaveValue("Only trade the open.");
  await expect(page.getByLabel("End of day recap")).toHaveValue("Stuck to it.");
  await expect(page.getByRole("radio", { name: "4", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("day-list")).toContainText("Plan, Recap, Rated 4");
});

test("templates: offered on an empty box, and editable in Settings", async ({ page }) => {
  try {
    await open(page, "/settings");
    const box = page.getByLabel("Daily plan template");
    await box.fill("My own checklist");
    await box.blur();
    await expect.poll(async () => (await (await page.request.get("/api/settings")).json()).settings.journalTemplates.plan).toBe("My own checklist");

    await open(page, "/day?date=2026-10-22");
    await page.getByRole("button", { name: "Start from your plan template" }).click();
    await expect(page.getByLabel("Pre-market plan")).toHaveValue("My own checklist");
    await expect(page.getByRole("button", { name: "Start from your plan template" })).toHaveCount(0);
  } finally {
    await settings(page, { journalTemplates: { plan: "", recap: "" } });
  }
});

test("the calendar links to the day", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/calendar?month=2026-10&day=2026-10-14");
  await page.getByRole("link", { name: "Open this day in the daily journal" }).click();
  await expect(page).toHaveURL(/\/day\?.*date=2026-10-14/);
  await expect(page.getByTestId("day-net")).toContainText("25.00");
});

test("columns: shown and hidden from the menu, kept after a reload, back to standard", async ({ page }) => {
  await importCsv(page, SET);
  try {
    await open(page, "/journal");
    await page.getByTestId("columns-menu").locator("summary").click();
    await page.getByRole("checkbox", { name: "Entry", exact: true }).check();
    await expect(page.locator('td[data-col="entry"]').first()).toBeVisible();
    await expect(page.locator('td[data-col="entry"]').first()).toContainText(/\d\.\d/);
    await page.getByRole("checkbox", { name: "Source", exact: true }).uncheck();
    await expect(page.locator('td[data-col="source"]')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('td[data-col="entry"]').first()).toBeVisible();
    await expect(page.locator('td[data-col="source"]')).toHaveCount(0);

    await page.getByTestId("columns-menu").locator("summary").click();
    await page.getByRole("button", { name: "Back to the standard columns" }).click();
    await expect(page.locator('td[data-col="entry"]')).toHaveCount(0);
    await expect(page.locator('td[data-col="source"]').first()).toBeVisible();
  } finally {
    await settings(page, { journalColumns: null });
  }
});

test("the held column sorts", async ({ page }) => {
  await importCsv(page, ["EURUSD,buy,2026-10-14 09:00,2026-10-14 09:05,1.1,1.11,1000,,,0", "GBPUSD,buy,2026-10-14 09:00,2026-10-14 12:00,1.3,1.31,1000,,,0"]);
  try {
    await settings(page, { journalColumns: ["hold"] });
    await open(page, "/journal");
    await page.getByRole("button", { name: "Held" }).click();
    await expect(rows(page).first()).toContainText("GBPUSD");
    await page.getByRole("button", { name: "Held" }).click();
    await expect(rows(page).first()).toContainText("EURUSD");
  } finally {
    await settings(page, { journalColumns: null });
  }
});

test("bulk: set a strategy and a tag, then move to another account", async ({ page }) => {
  await importCsv(page, SET);
  const second = (await (await page.request.post("/api/accounts", { data: { name: "Second", currency: "USD" } })).json()).account;
  await open(page, "/journal");
  await page.getByRole("checkbox", { name: "Select every trade on this page" }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });

  await bar.getByLabel("Strategy name").fill("Morning");
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Updated 4 trades.")).toBeVisible();
  await expect(bar).toHaveCount(0);
  const all = async () => (await (await page.request.get("/api/trades?pageSize=50")).json()).trades;
  expect((await all()).every((t: { strategy: string }) => t.strategy === "Morning")).toBe(true);

  await row(page, "AUDUSD").getByRole("checkbox").check();
  await bar.getByLabel("Bulk action").selectOption("addTag");
  await bar.getByLabel("Tag name").fill("reviewed");
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Updated 1 trade.")).toBeVisible();
  expect((await all()).find((t: { symbol: string }) => t.symbol === "AUDUSD").tags).toEqual(["reviewed"]);

  const before = (await all()).find((t: { symbol: string }) => t.symbol === "AUDUSD");
  await row(page, "AUDUSD").getByRole("checkbox").check();
  await bar.getByLabel("Bulk action").selectOption("moveAccount");
  await expect(bar.getByRole("button", { name: "Apply" })).toBeDisabled();
  await bar.getByLabel("Move to").selectOption(String(second.id));
  await bar.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Updated 1 trade.").last()).toBeVisible();
  const after = (await all()).find((t: { symbol: string }) => t.symbol === "AUDUSD");
  expect(after.accountId).toBe(second.id);
  expect(after.pnl).toBe(before.pnl);
});

test("export: the file matches the filter, reimports, and a selection exports alone", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/journal?symbol=EURUSD");
  await expect(rows(page)).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const file = await (await download).path();
  const lines = readFileSync(file, "utf8").trim().split("\r\n");
  expect(lines.length).toBe(3); // Header and two trades.
  expect(lines.slice(1).every((l) => l.includes("EURUSD"))).toBe(true);

  await rows(page).first().getByRole("checkbox").check();
  const one = page.waitForEvent("download");
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("link", { name: "Export selected" }).click();
  expect(readFileSync(await (await one).path(), "utf8").trim().split("\r\n").length).toBe(2);

  // Back into an empty account, through the same dialog as any broker file.
  const other = (await (await page.request.post("/api/accounts", { data: { name: "Restore", currency: "USD" } })).json()).account;
  await open(page, `/journal?import=1`);
  const box = dialog(page);
  await box.getByLabel("File (drop it here or browse)").setInputFiles({ name: "jarvis.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\r\n")) });
  await box.getByLabel("Import into account").selectOption(String(other.id));
  await box.getByRole("button", { name: "Import 2 trades" }).click();
  await expect(figure(box, "Imported")).toHaveText("2");
  const back = (await (await page.request.get(`/api/trades?accountId=${other.id}`)).json()).trades;
  const original = (await (await page.request.get(`/api/trades?symbol=EURUSD&pageSize=50`)).json()).trades.filter((t: { accountId: number }) => t.accountId !== other.id);
  expect(back.map((t: { pnl: number }) => t.pnl).sort()).toEqual(original.map((t: { pnl: number }) => t.pnl).sort());
});

test("a starting balance can be edited, and percent results use it", async ({ page }) => {
  await importCsv(page, ["EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1,1.11,1000,,,0"]);
  await open(page, "/settings");
  const box = page.getByLabel("Starting balance of Main account");
  await box.fill("1000");
  await box.blur();
  await expect(page.getByText("Starting balance of Main account saved.")).toBeVisible();
  await box.fill("-5");
  await box.blur();
  await expect(page.getByText("Enter 0 or more")).toBeVisible();
  const a = await (await page.request.get("/api/analytics?unit=percent")).json();
  expect(a.display).toBe("%");
  expect(a.metrics.netPnl).toBe(1); // 10 of 1,000
});

test("the sample journal fills the daily journal, labelled, and leaves with it", async ({ page }) => {
  await loadSample(page);
  const { days } = await (await page.request.get("/api/daily?includeSample=1")).json();
  expect(days.length).toBeGreaterThan(10);
  await open(page, `/day?includeSample=1&date=${days[0].date}`);
  await expect(page.getByText("Made-up sample notes.")).toBeVisible();
  expect((await (await page.request.get("/api/daily")).json()).days.length).toBe(0);
  await page.request.delete("/api/data/sample");
  expect((await (await page.request.get("/api/daily?includeSample=1")).json()).days.length).toBe(0);
});
