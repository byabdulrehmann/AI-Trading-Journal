import { dialog, expect, loadSample, open, rows, test } from "./helpers";
import type { Page } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const fits = async (page: Page, where: string) => {
  const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, body: document.body.scrollWidth, width: document.documentElement.clientWidth }));
  expect(sizes.width, `${where}: viewport`).toBe(375);
  expect(sizes.page, `${where}: page width`).toBeLessThanOrEqual(sizes.width);
  expect(sizes.body, `${where}: body width`).toBeLessThanOrEqual(sizes.width);
};

test("at 375 px the dashboard, journal, analytics and calendar don't overflow sideways", async ({ page }) => {
  await loadSample(page);
  await fits(page, "dashboard");

  await open(page, "/journal?includeSample=1");
  await expect(rows(page).first()).toBeVisible();
  await fits(page, "journal");
  await page.getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("combobox", { name: "Outcome" })).toBeVisible();
  await fits(page, "journal with filters open");
  await rows(page).first().getByRole("button").first().tap();
  await expect(dialog(page).getByRole("heading", { name: /trade #\d+/ })).toBeVisible();
  await fits(page, "journal with a trade open");

  for (const tab of ["overview", "instruments", "playbooks", "behaviour", "risk", "wins", "compare"]) {
    await open(page, `/analytics?includeSample=1&tab=${tab}`);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    await fits(page, `reports: ${tab}`);
  }
  await open(page, "/analytics?includeSample=1&tab=time");
  await expect(page.locator("td[data-cell]").first()).toBeAttached();
  await fits(page, "reports: time");

  await open(page, "/calendar?includeSample=1");
  await expect(page.getByRole("grid")).toBeVisible();
  await fits(page, "calendar");
  await page.locator('[data-day][aria-label*="trade"]').first().tap();
  await expect(page.getByTestId("day-trades")).toBeVisible();
  await fits(page, "calendar with a day open");
});

test("at 375 px with no trades yet, the same screens fit too", async ({ page }) => {
  for (const path of ["/", "/journal", "/analytics", "/calendar"]) {
    await open(page, path);
    await expect(page.getByRole("heading").first()).toBeVisible();
    await fits(page, path);
  }
});
