import { CSV_HEAD, csvFile, dialog, expect, field, idOf, logTrade, open, range, rows, signUp, test } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");

test("a second user can't see or touch the first user's trades, by UI, URL or API", async ({ page, browser, guard, baseURL }) => {
  // The first user: a trade with an attachment, and an import batch.
  await open(page, "/journal");
  await logTrade(page, { symbol: "EURUSD", entry: "1.0850", exit: "1.0900", quantity: "1", multiplier: "100000", stop: "1.0800", commission: "7" });
  const tradeId = await idOf(rows(page).first());
  await page.getByRole("button", { name: `Edit trade #${tradeId}` }).click();
  const form = dialog(page);
  await expect(field(form, "Entry")).toHaveValue("1.085");
  await form.getByRole("button", { name: /^Attachments/ }).click();
  await form.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: PNG });
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();

  await page.getByRole("button", { name: "Import" }).first().click();
  await dialog(page).getByLabel("File (drop it here or browse)").setInputFiles(csvFile("mine.csv", [CSV_HEAD, "GBPUSD,buy,2026-10-05 09:00,2026-10-05 10:00,1.3000,1.3100,1000,,,0"].join("\n")));
  await dialog(page).getByRole("button", { name: "Import 1 trades" }).click();
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(rows(page)).toHaveCount(2);

  const own = await (await page.request.get(`/api/trades/${tradeId}`)).json();
  const attachmentId = own.trade.attachments[0].id;
  const accountId = own.trade.accountId;
  const { imports } = await (await page.request.get("/api/imports")).json();
  const batch = imports[0].id;

  // The second user, in a separate browser context, created through the API.
  const other = await browser.newContext({ baseURL });
  const theirs = await other.newPage();
  guard.watch(theirs);
  guard.allow(/status of 404/);
  await signUp(theirs, "Second");

  // In the UI.
  await open(theirs, "/journal");
  await expect(theirs.getByRole("heading", { name: "Your journal is empty" })).toBeVisible();
  await open(theirs, `/journal?q=${encodeURIComponent(`#${tradeId}`)}`);
  await expect(theirs.getByRole("heading", { name: "No trades match" })).toBeVisible();
  await expect(rows(theirs)).toHaveCount(0);
  await open(theirs, "/journal?symbol=EURUSD&closedOnly=1");
  await expect(rows(theirs)).toHaveCount(0);
  await open(theirs, "/");
  // The symbol filter above follows to the dashboard, which says nothing matches and offers to clear it.
  await theirs.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(theirs.getByRole("heading", { name: "Start your journal" })).toBeVisible();
  await theirs.keyboard.press("Control+k");
  await dialog(theirs).getByLabel("Search screens and trades").fill("EURUSD");
  await expect(dialog(theirs).getByText("Nothing matches.")).toBeVisible();
  await theirs.keyboard.press("Escape");
  await open(theirs, "/calendar?month=2026-10&day=2026-10-05");
  await expect(theirs.getByTestId("day-trades")).toContainText("No trades closed or opened on this day.");
  await open(theirs, `/journal?accountId=${accountId}`);
  await expect(rows(theirs)).toHaveCount(0);

  // By direct call to the first user's ids.
  const api = theirs.request;
  for (const res of [
    await api.get(`/api/trades/${tradeId}`),
    await api.put(`/api/trades/${tradeId}`, { data: {} }),
    await api.post(`/api/trades/${tradeId}`),
    await api.post(`/api/trades/${tradeId}/attachments`, { multipart: { kind: "chart", file: { name: "x.png", mimeType: "image/png", buffer: PNG } } }),
    await api.get(`/api/attachments/${attachmentId}`),
    await api.delete(`/api/attachments/${attachmentId}`),
    await api.get(`/api/imports/${batch}/errors`),
    await api.patch(`/api/accounts/${accountId}`, { data: { name: "Taken" } }),
  ]) {
    expect(`${res.url()} ${res.status()}`).toBe(`${res.url()} 404`);
  }

  // Collections and bulk calls answer, but with nothing of the first user's, and change nothing.
  expect((await (await api.get("/api/trades")).json()).total).toBe(0);
  expect((await (await api.get(`/api/trades?accountId=${accountId}`)).json()).total).toBe(0);
  expect((await (await api.get(`/api/trades?q=${encodeURIComponent(`#${tradeId}`)}`)).json()).total).toBe(0);
  expect((await (await api.get("/api/analytics")).json()).metrics.totalTrades).toBe(0);
  expect((await (await api.get("/api/imports")).json()).imports).toEqual([]);
  expect((await (await api.post("/api/trades/delete", { data: { ids: [tradeId], deleted: true } })).json()).changed).toBe(0);
  expect((await (await api.delete(`/api/imports/${batch}`)).json()).removed).toBe(0);
  const intoTheirAccount = await api.post("/api/trades", { data: { accountId, symbol: "EURUSD", side: "long", openedAt: new Date().toISOString(), entryPrice: 1.1, quantity: 1 } });
  expect(intoTheirAccount.ok()).toBe(false);

  await other.close();

  // And the first user still has all of it.
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await expect(range(page)).toHaveText("1 to 2 of 2");
  const after = await (await page.request.get(`/api/trades/${tradeId}`)).json();
  expect(after.trade.attachments).toHaveLength(1);
  expect((await page.request.get(`/api/attachments/${attachmentId}`)).status()).toBe(200);
});
