import { dialog, expect, field, importCsv, loadSample, open, row, test } from "./helpers";

const SET = [
  "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1000,1.1100,1000,1.0900,,0", // +10
  "GBPUSD,sell,2026-10-14 11:00,2026-10-14 12:00,1.3000,1.2800,1000,1.3100,,0", // +20
  "EURUSD,buy,2026-10-15 09:00,2026-10-15 10:00,1.1000,1.0950,1000,1.0900,,0", // -5
];

test("create from scratch and from a template, then write rules that stay after a reload", async ({ page, guard }) => {
  guard.allow(/status of 422/); // The duplicate name at the end.
  await open(page, "/playbooks");
  await expect(page.getByRole("heading", { name: "No playbooks yet" })).toBeVisible();

  await page.getByLabel("New playbook").fill("My setup");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/playbook=\d+/);

  const rules = page.getByTestId("rules");
  await rules.getByLabel("New Entry rule").fill("Wait for the close");
  await rules.getByLabel("New Entry rule").press("Enter");
  await expect(rules.getByLabel("Rule: Wait for the close", { exact: true })).toBeVisible();
  await rules.getByLabel("New Risk rule").fill("One percent at most");
  await rules.getByRole("region", { name: "Risk rules" }).getByRole("button", { name: "Add" }).click();
  await expect(rules.getByLabel("Rule: One percent at most", { exact: true })).toBeVisible();

  const edit = rules.getByLabel("Rule: Wait for the close", { exact: true });
  await edit.fill("Wait for the bar to close");
  await edit.press("Enter");
  await expect(rules.getByLabel("Rule: Wait for the bar to close", { exact: true })).toBeVisible();

  await page.getByLabel("What this setup is").fill("A break of the morning range.");
  await page.getByLabel("What this setup is").blur();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("rules").getByLabel("Rule: Wait for the bar to close", { exact: true })).toBeVisible();
  await expect(page.getByLabel("What this setup is")).toHaveValue("A break of the morning range.");

  await page.getByTestId("rules").getByRole("button", { name: "Remove rule: One percent at most" }).click();
  await expect(page.getByTestId("rules").getByLabel("Rule: One percent at most", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "All playbooks" }).click();
  await page.getByLabel("Start from a template").selectOption("Range fade");
  await expect(page).toHaveURL(/playbook=\d+/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Range fade");
  await expect(page.getByTestId("rules").getByLabel(/^Rule: /).first()).toBeVisible();

  await page.getByRole("link", { name: "All playbooks" }).click();
  await expect(page.getByLabel("Start from a template").locator("option", { hasText: "Range fade" })).toHaveCount(0);
  await page.getByLabel("New playbook").fill("My setup");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("You already have a playbook with that name.")).toBeVisible();
});

test("a trade's checklist feeds adherence and the on-rule figures, by hand", async ({ page }) => {
  await importCsv(page, SET);
  const created = await (await page.request.post("/api/playbooks", { data: { name: "Morning", rules: [{ group: "Entry", text: "Rule one" }, { group: "Risk", text: "Rule two" }] } })).json();
  const all = (await (await page.request.get("/api/trades?pageSize=50")).json()).trades;
  await page.request.post("/api/trades/bulk", { data: { ids: all.map((t: { id: number }) => t.id), action: { type: "setStrategy", name: "Morning" } } });

  // GBPUSD (+20): both rules. EURUSD loser (-5): one of two. EURUSD winner (+10): not reviewed.
  await open(page, "/journal");
  await row(page, "GBPUSD").getByRole("button", { name: "GBPUSD" }).click();
  const drawer = dialog(page).getByTestId("checklist");
  await expect(drawer).toContainText("Not reviewed yet");
  await drawer.getByRole("checkbox", { name: "Rule one" }).check();
  await drawer.getByRole("checkbox", { name: "Rule two" }).check();
  await expect(drawer).toContainText("2 of 2 followed");
  await drawer.getByRole("button", { name: "Clear my answers" }).click();
  await expect(drawer).toContainText("Not reviewed yet");
  await expect(drawer.getByRole("checkbox", { name: "Rule one" })).not.toBeChecked();
  await drawer.getByRole("checkbox", { name: "Rule one" }).check();
  await drawer.getByRole("checkbox", { name: "Rule two" }).check();
  await expect(drawer).toContainText("2 of 2 followed");
  await page.keyboard.press("Escape");

  const loser = all.find((t: { pnl: number }) => t.pnl === -5);
  await page.request.put(`/api/trades/${loser.id}/rules`, { data: { checked: [created.playbook.rules[0].id] } });

  await open(page, `/playbooks?playbook=${created.playbook.id}`);
  await expect(page.getByText("3 of 2").or(page.getByText("2 of 3 trades reviewed"))).toBeVisible();
  const table = page.getByTestId("on-off-rules");
  await expect(table.getByRole("row", { name: /Every rule followed/ })).toContainText("+$20.00");
  await expect(table.getByRole("row", { name: /A rule missed/ })).toContainText("−$5.00");

  const stats = (await (await page.request.get("/api/playbooks")).json()).playbooks[0].stats;
  expect(stats.adherence).toBeCloseTo(3 / 4); // 2 of 2, 1 of 2
  expect(stats.netPnl).toBe(25); // 10 + 20 - 5
  expect(stats.reviewed).toBe(2);

  await open(page, "/playbooks");
  const line = page.locator('[data-playbook="Morning"]');
  await expect(line).toContainText("75%");
  await expect(line).toContainText("+$25.00");
});

test("a trade with no playbook shows no checklist, and an empty playbook links to add rules", async ({ page }) => {
  await importCsv(page, SET.slice(0, 1));
  await open(page, "/journal");
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  await expect(dialog(page).getByRole("heading", { name: /EURUSD/ })).toBeVisible();
  await expect(dialog(page).getByTestId("checklist")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const t = (await (await page.request.get("/api/trades")).json()).trades[0];
  await page.request.post("/api/playbooks", { data: { name: "Empty one", rules: [] } });
  await page.request.post("/api/trades/bulk", { data: { ids: [t.id], action: { type: "setStrategy", name: "Empty one" } } });
  await open(page, "/journal");
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  await expect(dialog(page).getByTestId("checklist")).toContainText("no rules yet");
  await dialog(page).getByRole("link", { name: "Add some" }).click();
  await expect(page).toHaveURL(/playbook=\d+/);
  await expect(page.getByTestId("rules")).toBeVisible();
});

test("missed trades: logged with their R, listed, removed, and never in results", async ({ page, guard }) => {
  guard.allow(/status of 4\d\d/); // The stop on the wrong side.
  await open(page, "/playbooks");
  await page.getByLabel("New playbook").fill("Watched");
  await page.getByRole("button", { name: "Create" }).click();
  const form = page.getByRole("form", { name: "Log a missed trade" });
  await field(form, "Instrument").fill("aapl");
  await field(form, "Entry").fill("100");
  await field(form, "Stop").fill("101");
  await form.getByRole("button", { name: "Log missed trade" }).click();
  await expect(form.getByText("For a long, the stop sits below entry")).toBeVisible();

  await field(form, "Stop").fill("98");
  await field(form, "Would have exited").fill("106");
  await field(form, "Why you passed").fill("Hesitated");
  await form.getByRole("button", { name: "Log missed trade" }).click();
  const list = page.getByTestId("missed-list");
  await expect(list).toContainText("AAPL");
  await expect(list).toContainText("+3.00R"); // +6 on 2 of risk
  await expect(page.getByTestId("missed-summary")).toContainText("+3.00R");

  expect((await (await page.request.get("/api/analytics")).json()).metrics.totalTrades).toBe(0);
  await list.getByRole("button", { name: "Remove missed AAPL" }).click();
  await expect(page.getByTestId("missed-list")).toHaveCount(0);
});

test("renaming keeps the trades, deleting keeps them too, with no playbook", async ({ page }) => {
  await importCsv(page, SET.slice(0, 1));
  const t = (await (await page.request.get("/api/trades")).json()).trades[0];
  const made = await (await page.request.post("/api/playbooks", { data: { name: "Before", rules: [] } })).json();
  await page.request.post("/api/trades/bulk", { data: { ids: [t.id], action: { type: "setStrategy", name: "Before" } } });

  await open(page, `/playbooks?playbook=${made.playbook.id}`);
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("After");
  await name.blur();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  expect((await (await page.request.get(`/api/trades/${t.id}`)).json()).trade.strategy).toBe("After");

  await page.getByRole("link", { name: "Open its trades" }).click();
  await expect(page).toHaveURL(/\/journal\?.*strategy=/);
  await expect(row(page, "EURUSD")).toHaveCount(1);

  await open(page, `/playbooks?playbook=${made.playbook.id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete playbook" }).click();
  await expect(page.getByRole("heading", { name: "No playbooks yet" })).toBeVisible();
  const after = (await (await page.request.get(`/api/trades/${t.id}`)).json()).trade;
  expect(after.strategy).toBe("");
  expect(after.pnl).toBe(t.pnl);
});

test("side by side: the table matches the API, respects filters, and sample playbooks are labelled", async ({ page }) => {
  await loadSample(page);
  const api = await (await page.request.get("/api/playbooks?includeSample=1")).json();
  expect(api.playbooks.length).toBeGreaterThanOrEqual(5);
  await open(page, "/playbooks?includeSample=1");
  const table = page.getByTestId("playbook-table");
  for (const p of api.playbooks) {
    const line = table.locator(`[data-playbook="${p.name}"]`);
    await expect(line).toContainText(String(p.stats.closed));
    await expect(line).toContainText("Sample");
  }
  const totalInPlaybooks = api.playbooks.reduce((n: number, p: { stats: { closed: number } }) => n + p.stats.closed, 0) + api.unassigned.closed;
  const analytics = await (await page.request.get("/api/analytics?includeSample=1")).json();
  expect(totalInPlaybooks).toBe(analytics.metrics.closedTrades);

  // Without sample data none of them show.
  expect((await (await page.request.get("/api/playbooks")).json()).playbooks).toEqual([]);

  // The global filter narrows them.
  const long = await (await page.request.get("/api/playbooks?includeSample=1&side=long")).json();
  expect(long.playbooks[0].stats.closed).toBeLessThan(api.playbooks[0].stats.closed);

  await table.locator(`[data-playbook="${api.playbooks[0].name}"]`).getByRole("link").click();
  await expect(page.getByTestId("rules").getByLabel(/^Rule: /).first()).toBeVisible();
  await expect(page.getByTestId("missed-list")).toContainText("Sample");

  await page.request.delete("/api/data/sample");
  expect((await (await page.request.get("/api/playbooks?includeSample=1")).json()).playbooks).toEqual([]);
});
