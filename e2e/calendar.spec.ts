import { dialog, expect, figure, importCsv, open, test, usd } from "./helpers";
import type { Page } from "@playwright/test";

// Net by hand: +10 and +20 on Oct 14, -5 on Oct 15, +30 on Sep 21.
const SET = [
  "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1000,1.1100,1000,1.0900,,0",
  "GBPUSD,sell,2026-10-14 11:00,2026-10-14 12:00,1.3000,1.2800,1000,1.3100,,0",
  "EURUSD,buy,2026-10-15 09:00,2026-10-15 10:00,1.1000,1.0950,1000,1.0900,,0",
  "XAUUSD,buy,2026-09-21 09:00,2026-09-21 10:00,2000,2030,1,1990,,0",
];

const day = (page: Page, key: string) => page.locator(`[data-day="${key}"]`);
const listed = (page: Page) => page.getByTestId("day-trades").locator("ul > li");
const monthHeading = (page: Page, name: string) => page.locator('section[aria-label="Month grid"]').getByRole("heading", { name });

test("selecting a day by click lists its trades, and the month figures add up", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/calendar");
  await expect(monthHeading(page, "October 2026")).toBeVisible();
  await expect(figure(page, "Trades")).toHaveText("3");
  await expect(figure(page, "Won")).toHaveText("2");
  await expect(figure(page, "Lost")).toHaveText("1");
  await expect(figure(page, "Days traded")).toHaveText("2");
  await expect(page.locator("aside .figure")).toHaveText(usd(25));
  await expect(page.getByText("Pick a day to list its trades here.")).toBeVisible();

  await expect(day(page, "2026-10-14")).toHaveAccessibleName(/\+\$30\.00, 2 trades, 2 won, 0 lost/);
  await day(page, "2026-10-14").click();
  await expect(page).toHaveURL(/day=2026-10-14/);
  await expect(day(page, "2026-10-14")).toHaveAttribute("aria-pressed", "true");
  await expect(listed(page)).toHaveCount(2);
  await expect(listed(page).filter({ hasText: "EURUSD" })).toContainText(usd(10));
  await expect(listed(page).filter({ hasText: "GBPUSD" })).toContainText(usd(20));

  await page.reload();
  await expect(listed(page)).toHaveCount(2);

  await listed(page).filter({ hasText: "GBPUSD" }).getByRole("button").click();
  await expect(dialog(page).getByRole("heading", { name: /GBPUSD short/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // A day with nothing says so; clicking the selected day clears it.
  await day(page, "2026-10-16").click();
  await expect(page.getByTestId("day-trades")).toContainText("No trades closed or opened on this day.");
  await day(page, "2026-10-16").click();
  await expect(page).not.toHaveURL(/day=/);
});

test("arrow keys move the day, Enter selects, and month edges change the month", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/calendar");
  await expect(monthHeading(page, "October 2026")).toBeVisible();

  await day(page, "2026-10-14").click();
  await expect(day(page, "2026-10-14")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(day(page, "2026-10-15")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/day=2026-10-15/);
  await expect(listed(page)).toHaveCount(1);
  await expect(listed(page).first()).toContainText(usd(-5));

  await page.keyboard.press("ArrowLeft");
  await expect(day(page, "2026-10-14")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(day(page, "2026-10-21")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(day(page, "2026-10-14")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(day(page, "2026-10-07")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(day(page, "2026-09-30")).toBeFocused();
  // Sep 23 isn't drawn in October's grid, so the month follows the cursor.
  await page.keyboard.press("ArrowUp");
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(day(page, "2026-09-23")).toBeFocused();
  for (const key of ["2026-09-16", "2026-09-09", "2026-09-02"]) {
    await page.keyboard.press("ArrowUp");
    await expect(day(page, key)).toBeFocused();
  }
  await page.keyboard.press("ArrowUp");
  await expect(page).toHaveURL(/month=2026-08/);
  await expect(monthHeading(page, "August 2026")).toBeVisible();
  await expect(day(page, "2026-08-26")).toBeFocused();

  await page.keyboard.press("PageDown");
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(monthHeading(page, "September 2026")).toBeVisible();
  await expect(day(page, "2026-09-26")).toBeFocused();
});

test("changing the month with the buttons shows that month's trades", async ({ page }) => {
  await importCsv(page, SET);
  await open(page, "/calendar");
  await day(page, "2026-10-14").click();

  await page.getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(page).not.toHaveURL(/day=/);
  await expect(monthHeading(page, "September 2026")).toBeVisible();
  await expect(figure(page, "Trades")).toHaveText("1");

  await day(page, "2026-09-21").click();
  await expect(listed(page)).toHaveCount(1);
  await expect(listed(page).first()).toContainText("XAUUSD");
  await expect(listed(page).first()).toContainText(usd(30));

  await page.reload();
  await expect(monthHeading(page, "September 2026")).toBeVisible();
  await expect(listed(page)).toHaveCount(1);

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(monthHeading(page, "October 2026")).toBeVisible();
  await expect(figure(page, "Trades")).toHaveText("3");
  await expect(page.getByText("Pick a day to list its trades here.")).toBeVisible();
});
