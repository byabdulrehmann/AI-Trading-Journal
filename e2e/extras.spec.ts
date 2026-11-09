import type { Page } from "@playwright/test";
import { dialog, expect, open, row, signUp, test } from "./helpers";

const accountId = async (page: Page) => (await (await page.request.get("/api/accounts")).json()).accounts[0].id as number;
/** A stock at 100 a share, one share, with a stop a point away: the result is the exit minus 100, in R too. */
const trade = async (page: Page, openedAt: string, minutes: number, exitPrice: number) => {
  const opened = Date.parse(openedAt);
  const res = await page.request.post("/api/trades", { data: { accountId: await accountId(page), symbol: "AAPL", side: "long", openedAt, closedAt: new Date(opened + minutes * 60_000).toISOString(), entryPrice: 100, exitPrice, stopPrice: 99, quantity: 1 } });
  expect(res.ok()).toBe(true);
  return (await res.json()).trade.id as number;
};
const tagsOf = async (page: Page, id: number) => (await (await page.request.get(`/api/trades/${id}`)).json()).trade.tags as string[];

test("a calendar CSV imports, and trades taken around its news get tagged", async ({ page }) => {
  const id = await trade(page, "2026-07-06T13:25:00.000Z", 30, 101);
  await open(page, "/news");
  await expect(page.getByText("No events yet")).toBeVisible();
  await page.getByRole("button", { name: "Import CSV" }).click();
  const d = dialog(page);
  await d.getByLabel("Times in the file are in").selectOption("Africa/Abidjan");
  await d.getByLabel("File", { exact: true }).setInputFiles({ name: "week.csv", mimeType: "text/csv", buffer: Buffer.from("date,time,currency,event,impact,forecast\n2026-07-06,13:30,USD,Non-farm payrolls,High,110K\n2026-07-06,soon,USD,Broken row,High,\n") });
  await expect(d.getByTestId("import-preview")).toContainText("1 event read from week.csv, 1 row skipped");
  await d.getByText("Rows that couldn't be read").click();
  await expect(d.getByText('Line 3: Couldn\'t read the time "soon".')).toBeVisible();
  await d.getByRole("button", { name: "Import 1 event" }).click();
  await expect(page.getByText("Imported 1 event.")).toBeVisible();

  await expect(page.getByText("No events match")).toBeVisible();
  await page.getByRole("radio", { name: "Past" }).click();
  await expect(page.getByTestId("event")).toContainText("Non-farm payrolls");
  await expect(page.getByTestId("event")).toContainText("110K");
  await page.getByRole("button", { name: "Add the rule" }).click();
  await expect(page.getByText("Added the rule. 1 trade tagged News so far.")).toBeVisible();
  expect(await tagsOf(page, id)).toContain("News");

  await open(page, "/journal");
  await row(page, "AAPL").getByRole("button", { name: "AAPL" }).click();
  await expect(dialog(page).getByTestId("trade-news")).toContainText("Non-farm payrolls");
  await expect(dialog(page).getByTestId("trade-news")).toContainText("5 min after the open");
});

test("an auto-tag rule built in Settings tags matching trades, and a removed tag stays off", async ({ page, guard }) => {
  guard.allow(/status of 422/);
  const quick = await trade(page, "2026-07-07T14:00:00.000Z", 3, 98);
  const slow = await trade(page, "2026-07-07T15:00:00.000Z", 60, 98);
  await open(page, "/settings#autotags");
  await page.getByLabel("Tag", { exact: true }).fill("Quick loss");
  await page.getByLabel("Condition 1", { exact: true }).selectOption({ label: "Minutes held" });
  await page.getByLabel("Value 1", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add a condition" }).click();
  await page.getByLabel("Condition 2", { exact: true }).selectOption({ label: "Result in R" });
  await page.getByLabel("Value 2", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Rule saved. 1 trade tagged Quick loss.")).toBeVisible();
  await expect(page.getByTestId("tag-rules")).toContainText("when minutes held is under 5, and result in r is under 0");
  expect(await tagsOf(page, quick)).toEqual(["Quick loss"]);
  expect(await tagsOf(page, slow)).toEqual([]);

  // Taking the tag off by hand: a later change to the trade doesn't bring it back.
  const t = (await (await page.request.get(`/api/trades/${quick}`)).json()).trade;
  expect((await page.request.put(`/api/trades/${quick}`, { data: { ...t, tags: [], executions: null } })).ok()).toBe(true);
  expect((await page.request.put(`/api/trades/${quick}`, { data: { ...t, tags: [], notes: "Too fast.", executions: null } })).ok()).toBe(true);
  expect(await tagsOf(page, quick)).toEqual([]);

  await page.getByLabel("Tag", { exact: true }).fill("Morning");
  await page.getByLabel("Condition 1", { exact: true }).selectOption({ label: "Hour opened" });
  await page.getByLabel("Value 1", { exact: true }).fill("24");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Enter an hour from 0 to 23")).toBeVisible();
  await page.getByRole("button", { name: "Delete the Quick loss rule" }).click();
  await expect(page.getByText("No rules yet.")).toBeVisible();
});

test("a trade's share picture is made in the browser and saved as a file", async ({ page }) => {
  const id = await trade(page, "2026-07-08T14:00:00.000Z", 45, 102);
  await open(page, "/journal");
  await row(page, "AAPL").getByRole("button", { name: "AAPL" }).click();
  await dialog(page).getByRole("button", { name: "Share" }).click();
  const share = page.locator("dialog[open]").filter({ hasText: `Share trade #${id}` });
  const canvas = share.getByTestId("share-canvas");
  await expect(canvas).toBeVisible();
  await share.getByRole("switch", { name: "Show money amounts" }).click();
  await expect(share.getByRole("switch", { name: "Show money amounts" })).toHaveAttribute("aria-checked", "true");
  // Something was drawn: a blank canvas compresses to a few hundred bytes.
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL("image/png").length)).toBeGreaterThan(5000);
  const download = page.waitForEvent("download");
  await share.getByRole("button", { name: "Save picture" }).click();
  expect((await download).suggestedFilename()).toBe(`AAPL-trade-${id}.png`);
});

test("the week's review counts its trades, and says when no AI model can write it", async ({ page }) => {
  const now = Date.now();
  await trade(page, new Date(now - 30 * 60_000).toISOString(), 10, 104);
  await trade(page, new Date(now - 15 * 60_000).toISOString(), 10, 99);
  await open(page, "/progress?tab=reviews");
  await expect(page.getByTestId("review-net")).toHaveText("+$3.00");
  await expect(page.getByTestId("review")).toContainText("(1 won, 1 lost)");
  await expect(page.getByTestId("review")).toContainText("Most traded: AAPL (2 trades, +$3.00).");
  await expect(page.getByTestId("ai-review")).toContainText("No AI model is connected");
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(page.getByText("No closed trades this week")).toBeVisible();
});

test("the owner backs up the database; names outside the backups and other users are refused", async ({ page, guard }) => {
  guard.allow(/status of (403|404|422)/);
  await open(page, "/settings#backups");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText("Backup made.")).toBeVisible();
  const first = page.getByTestId("backups").getByRole("row").filter({ hasText: "Made by you" }).first();
  const href = await first.getByRole("link", { name: "Download" }).getAttribute("href");
  const file = await page.request.get(href!);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 15).toString()).toBe("SQLite format 3");
  expect((await page.request.get("/api/backups/..%2Fkestrel.db")).status()).toBe(404);
  expect((await page.request.get("/api/backups/kestrel-nope.db")).status()).toBe(404);

  expect((await page.request.post("/api/events/import", { data: { csv: "when,what\n1,2", zone: "" } })).status()).toBe(422);
  expect((await page.request.post("/api/tag-rules", { data: { tag: "x", conditions: [{ field: "side", op: "is", value: "up" }] } })).status()).toBe(422);
  expect((await page.request.delete("/api/events/999999")).status()).toBe(404);

  await signUp(page, "Second");
  expect((await page.request.get("/api/backups")).status()).toBe(403);
  expect((await page.request.get(href!)).status()).toBe(403);
});
