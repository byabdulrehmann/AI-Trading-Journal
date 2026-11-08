import type { Page } from "@playwright/test";
import { dialog, expect, open, test } from "./helpers";

const accountId = async (page: Page) => (await (await page.request.get("/api/accounts")).json()).accounts[0].id as number;
// A stock at 100 a share, one share: the result is the exit minus 100.
const trade = async (page: Page, account: number, closedAt: string, result: number) => {
  const closed = Date.parse(closedAt);
  const res = await page.request.post("/api/trades", { data: { accountId: account, symbol: "AAPL", side: "long", openedAt: new Date(closed - 60_000).toISOString(), closedAt, entryPrice: 100, exitPrice: 100 + result, quantity: 1 } });
  expect(res.ok()).toBe(true);
};

test("a challenge set up in the page checks its rules and passes", async ({ page }) => {
  const account = await accountId(page);
  await trade(page, account, "2026-07-01T12:00:00.000Z", 400);
  await trade(page, account, "2026-07-02T12:00:00.000Z", -300);
  await trade(page, account, "2026-07-03T12:00:00.000Z", 900);
  await open(page, "/progress");
  await expect(page.getByText("No challenges yet")).toBeVisible();
  await page.getByRole("button", { name: "New challenge" }).first().click();
  const d = dialog(page);
  await d.getByLabel("Name").fill("Phase one");
  await d.getByLabel("Account size").fill("10000");
  await d.getByRole("button", { name: "Fill common two-step rules" }).click();
  await expect(d.getByLabel("Daily loss limit")).toHaveValue("500");
  await expect(d.getByText("10% of the account.").first()).toBeVisible();
  await d.getByLabel("Starts", { exact: true }).fill("2026-07-01");
  await d.getByLabel("Minimum trading days").fill("3");
  await d.getByRole("button", { name: "Save challenge" }).click();

  const card = page.getByTestId("challenge-card");
  await expect(card.getByText("Passed")).toBeVisible();
  await expect(card.getByText("+$1,000.00").first()).toBeVisible();
  await expect(card.getByTestId("rule-target")).toContainText("Met");
  await expect(card.getByTestId("rule-days")).toContainText("3 of 3 days");
  await expect(card.getByTestId("rule-daily")).toContainText("Within limit");

  // Tightening the daily limit past Monday's fall turns it into a failed challenge.
  await card.getByRole("button", { name: "Edit rules" }).click();
  await dialog(page).getByLabel("Daily loss limit").fill("300");
  await dialog(page).getByRole("button", { name: "Save challenge" }).click();
  await expect(card.getByText("Failed")).toBeVisible();
  await expect(card.getByRole("note")).toContainText("daily loss limit was reached on Jul 2, 2026");
});

test("a limit close to breaking today shows on the dashboard", async ({ page }) => {
  const account = await accountId(page);
  const today = new Date();
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await trade(page, account, new Date(Date.now() - 60_000).toISOString(), -450);
  const created = await page.request.post("/api/challenges", { data: { accountId: account, name: "Funded 10k", startDate: start, accountSize: 10000, dailyLoss: 500, maxLoss: 1000 } });
  expect(created.status()).toBe(201);
  await open(page, "/");
  await expect(page.getByTestId("challenge-alerts")).toContainText("Funded 10k: daily loss close to its limit. $450.00 of $500.00 used, $50.00 left.");
  await page.getByRole("link", { name: "See the challenge" }).click();
  await expect(page).toHaveURL(/\/progress/);
  await expect(page.getByTestId("rule-daily")).toContainText("Close to limit");
});

test("routine, streaks and goals", async ({ page, guard }) => {
  guard.allow(/status of 422/);
  await open(page, "/progress?tab=routine");
  await page.getByLabel("New step").fill("Check the news calendar");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("New step").fill("Mark the levels");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const routine = page.getByTestId("routine");
  await routine.getByRole("checkbox", { name: "Check the news calendar" }).check();
  await expect(page.getByTestId("streak-routine")).toContainText("0days");
  await routine.getByRole("checkbox", { name: "Mark the levels" }).check();
  // Weekends don't count toward a run of days.
  const weekday = ![0, 6].includes(new Date().getDay());
  await expect(page.getByTestId("streak-routine")).toContainText(`${weekday ? 1 : 0}days`);
  await page.reload();
  await expect(page.getByTestId("routine").getByRole("checkbox", { name: "Mark the levels" })).toBeChecked();

  await page.getByLabel("Goal", { exact: true }).selectOption("net_pnl");
  await page.getByLabel(/^Amount/).fill("500");
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByTestId("goal")).toContainText("Net P&L $500.00, each week");
  await expect(page.getByTestId("goal")).toContainText("$0.00Not yet");
  await page.getByLabel(/^Percent|^Amount/).fill("");
  await page.getByLabel("Goal", { exact: true }).selectOption("win_rate");
  await page.getByLabel("Percent").fill("150");
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByText("At most 100%")).toBeVisible();
  await page.getByRole("button", { name: "Delete goal Net P&L" }).click();
  await expect(page.getByTestId("goal")).toHaveCount(0);

  await page.getByRole("button", { name: "Retire Mark the levels" }).click();
  await expect(page.getByTestId("routine").getByRole("checkbox", { name: "Mark the levels" })).toHaveCount(0);
});

test("spending adds up per currency and entries can be deleted", async ({ page }) => {
  await open(page, "/progress?tab=spending");
  const add = async (what: string, amount: string) => {
    await page.getByLabel("What").selectOption({ label: what });
    await page.getByLabel("Amount").fill(amount);
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByLabel("Amount")).toHaveValue("");
  };
  await page.getByLabel("Firm").fill("Example firm");
  await add("Challenge fee", "99");
  await add("Reset", "50");
  await add("Payout", "400");
  await expect(page.getByTestId("spending-net")).toHaveText("+$251.00");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /^Delete Reset/ }).click();
  await expect(page.getByTestId("spending-net")).toHaveText("+$301.00");
});

test("the routes refuse bad input and other people's things", async ({ page, guard }) => {
  guard.allow(/status of (404|422)/);
  const account = await accountId(page);
  const bad = await page.request.post("/api/challenges", { data: { accountId: account, name: "X", startDate: "2026-07-05", endDate: "2026-07-01", accountSize: 10000 } });
  expect(bad.status()).toBe(422);
  expect((await page.request.post("/api/challenges", { data: { accountId: 999999, name: "X", startDate: "2026-07-01", accountSize: 10000 } })).status()).toBe(422);
  expect((await page.request.delete("/api/challenges/999999")).status()).toBe(404);
  expect((await page.request.put("/api/routine/checks", { data: { date: "2999-01-01", itemId: 1, checked: true } })).status()).toBe(422);
});
