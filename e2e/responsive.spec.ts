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

const WIDTHS = [320, 414, 768, 1024, 1280, 1366, 1536, 1920];
const PAGES = ["/", "/day", "/journal", "/notebook", "/progress", "/playbooks", "/analytics", "/backtest", "/replay", "/calendar", "/patterns", "/market", "/news", "/jarvis", "/accounts", "/settings"];

/** What sticks out past the screen's edge, or out of its card, outside anything that scrolls sideways on purpose. */
const breakage = (page: Page) =>
  page.evaluate(() => {
    const scrolls = (el: Element | null) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) if (["auto", "scroll"].includes(getComputedStyle(e).overflowX)) return true;
      return false;
    };
    const out = new Set<string>();
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.position === "fixed" || cs.position === "absolute" || el.closest(".sr-only, [hidden]") || scrolls(el.parentElement)) continue;
      const name = `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
      if (r.right > innerWidth + 1 || r.left < -1) out.add(`off the screen: ${name}`);
      const card = el.parentElement?.closest("section");
      if (card && r.right > card.getBoundingClientRect().right + 1) out.add(`out of its card: ${name}`);
    }
    return [...out];
  });

test.describe("every page at every width", () => {
  test.use({ isMobile: false, hasTouch: false });

  test("nothing sticks out of the screen or its card, and the Avg win/loss bar sits beside its value", async ({ page }) => {
    test.setTimeout(600_000);
    await loadSample(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of PAGES) {
        await open(page, `${path}?includeSample=1`);
        await page.waitForLoadState("networkidle");
        expect(await breakage(page), `${path} at ${width} px`).toEqual([]);
      }
      // On the dashboard, the bar is under the label, beside the value, never across them.
      await open(page, "/?includeSample=1");
      const card = page.getByTestId("kpi-avg");
      const [label, value, bar] = await Promise.all([card.locator("h2").boundingBox(), page.getByTestId("kpi-avg-value").boundingBox(), page.getByTestId("kpi-avg-bar").boundingBox()]);
      expect(bar!.y, `bar below the label at ${width} px`).toBeGreaterThanOrEqual(label!.y + label!.height);
      expect(bar!.x, `bar right of the value at ${width} px`).toBeGreaterThanOrEqual(value!.x + value!.width);
      expect(bar!.width, `bar wide enough to read at ${width} px`).toBeGreaterThan(60);
      // Every KPI label shows in full.
      for (const id of ["kpi-net", "kpi-winrate", "kpi-pf", "kpi-daywin", "kpi-avg"]) {
        const label = page.getByTestId(id).locator("h2 span").first();
        expect(await label.evaluate((e) => e.scrollWidth <= e.clientWidth), `${id} label at ${width} px`).toBe(true);
      }
    }
  });
});
