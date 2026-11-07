import { dialog, expect, field, figure, idOf, importCsv, logTrade, open, r, range, row, rows, test, usd } from "./helpers";

// 1 lot x 100000: (1.0900 - 1.0850) x 100000 = 500 gross, less 7 commission = 493 net. Risk (1.0850 - 1.0800) x 100000 = 500, so R = 493 / 500 = 0.986.
const EURUSD = { symbol: "EURUSD", entry: "1.0850", exit: "1.0900", quantity: "1", multiplier: "100000", stop: "1.0800", commission: "7" };

test("a manual trade from the form persists with its figures after a refresh", async ({ page }) => {
  await open(page, "/journal");
  await expect(page.getByRole("heading", { name: "Your journal is empty" })).toBeVisible();

  await page.getByRole("button", { name: "Log trade" }).first().click();
  const form = dialog(page);
  await field(form, "Instrument").fill(EURUSD.symbol);
  await field(form, "Entry").fill(EURUSD.entry);
  await field(form, "Exit").fill(EURUSD.exit);
  await field(form, "Quantity").fill(EURUSD.quantity);
  await field(form, "Stop").fill(EURUSD.stop);
  await field(form, "Contract multiplier").fill(EURUSD.multiplier);
  await field(form, "Commission").fill(EURUSD.commission);
  // The live preview must agree with what gets saved.
  await expect(figure(form, "Gross")).toHaveText(usd(500));
  await expect(figure(form, "Net")).toHaveText(usd(493));
  await expect(figure(form, "R")).toHaveText(r(0.99));
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Logged EURUSD.")).toBeVisible();

  const checkRow = async () => {
    const line = row(page, "EURUSD");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(usd(493));
    await expect(line).toContainText(r(0.99));
    await expect(line).toContainText("Closed");
    await expect(line).toContainText("Manual");
  };
  await checkRow();

  await page.reload();
  await checkRow();

  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  const drawer = dialog(page);
  await expect(drawer.getByRole("heading", { name: /EURUSD long, trade #\d+/ })).toBeVisible();
  await expect(drawer.getByText(usd(493), { exact: true })).toBeVisible();
  await expect(drawer.getByText(r(0.99), { exact: true })).toBeVisible();
  await expect(figure(drawer, "Gross P&L")).toHaveText(usd(500));
  await expect(figure(drawer, "Commission")).toHaveText(usd(7, false));
  await expect(figure(drawer, "Risk")).toHaveText(usd(500, false));
  await expect(figure(drawer, "Entry")).toHaveText("1.085");
  await expect(figure(drawer, "Exit")).toHaveText("1.09");
  await expect(figure(drawer, "Stop")).toHaveText("1.08");
  await expect(figure(drawer, "Size")).toHaveText("1 × 100000");
  await expect(figure(drawer, "Remaining")).toHaveText("0");
  await expect(figure(drawer, "Pips")).toHaveText("50");
});

test("editing a trade recalculates the journal and the dashboard", async ({ page }) => {
  await open(page, "/journal");
  await logTrade(page, EURUSD);

  // Exit moves to 1.0950: gross 1000, net 993, R 993 / 500 = 1.986.
  const id = await idOf(row(page, "EURUSD"));
  await page.getByRole("button", { name: `Edit trade #${id}` }).click();
  const form = dialog(page);
  await expect(form.getByRole("heading", { name: `Edit trade #${id}` })).toBeVisible();
  await expect(field(form, "Entry")).toHaveValue("1.085");
  await field(form, "Exit").fill("1.0950");
  await expect(figure(form, "Net")).toHaveText(usd(993));
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();
  await expect(row(page, "EURUSD")).toContainText(usd(993));
  await expect(row(page, "EURUSD")).toContainText(r(1.99));

  // Reopened straight away, the form holds the saved values, not the ones it first opened with.
  await page.getByRole("button", { name: `Edit trade #${id}` }).click();
  await expect(field(form, "Exit")).toHaveValue("1.095");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);

  // A loser: (1995 - 2000) x 1 x 100 = -500 gross, less 10 = -510 net. Risk (2000 - 1990) x 100 = 1000, R = -0.51.
  await logTrade(page, { symbol: "XAUUSD", entry: "2000", exit: "1995", quantity: "1", multiplier: "100", stop: "1990", commission: "10" });
  await expect(row(page, "XAUUSD")).toContainText(usd(-510));
  await expect(row(page, "XAUUSD")).toContainText(r(-0.51));

  await open(page, "/");
  // Totals by hand: 993 - 510 = 483. One win of two. 993 / 510 = 1.947. 483 / 2 = 241.50. (1.986 - 0.51) / 2 = 0.738.
  await expect(figure(page, "Net P&L")).toHaveText(usd(483));
  await expect(figure(page, "Gross profit")).toHaveText(usd(993, false));
  await expect(figure(page, "Gross loss")).toHaveText(usd(-510, false));
  await expect(figure(page, "Profit factor")).toHaveText("1.95");
  await expect(figure(page, "Expectancy")).toHaveText(usd(241.5));
  await expect(figure(page, "Win rate")).toHaveText("50.0%");
  await expect(figure(page, "Average R")).toHaveText(r(0.74));
  await expect(figure(page, "Total fees")).toHaveText(usd(17, false));
  await expect(figure(page, "Closed")).toHaveText("2");
  await expect(figure(page, "Winning")).toHaveText("1");
  await expect(figure(page, "Losing")).toHaveText("1");
  await expect(page.getByText(usd(483), { exact: true }).first()).toBeVisible();
});

test.describe("finding trades", () => {
  // Units, multiplier 1. Net by hand: +10, -5, +20, -10.
  const SET = [
    "EURUSD,buy,2026-10-05 09:00,2026-10-05 10:00,1.1000,1.1100,1000,1.0900,,0",
    "EURUSD,buy,2026-10-06 09:00,2026-10-06 10:00,1.1000,1.0950,1000,1.0900,,0",
    "GBPUSD,sell,2026-10-07 09:00,2026-10-07 10:00,1.3000,1.2800,1000,1.3100,,0",
    "GBPUSD,sell,2026-10-20 09:00,2026-10-20 10:00,1.3000,1.3100,1000,1.3200,,0",
  ];

  test("instrument, date and outcome filters narrow the list and survive a reload", async ({ page }) => {
    await importCsv(page, SET);
    await expect(rows(page)).toHaveCount(4);

    await page.getByRole("combobox", { name: "Instrument" }).selectOption("EURUSD");
    await expect(page).toHaveURL(/symbol=EURUSD/);
    await expect(rows(page)).toHaveCount(2);

    await page.getByRole("combobox", { name: "Outcome" }).selectOption("win");
    await expect(page).toHaveURL(/outcome=win/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText(usd(10));

    await page.getByRole("combobox", { name: "Date range, by open time" }).selectOption("custom");
    await page.getByLabel("From date").fill("2026-10-05");
    await page.getByLabel("To date").fill("2026-10-05");
    await expect(page).toHaveURL(/range=custom/);
    await expect(page).toHaveURL(/from=2026-10-05/);
    await expect(page).toHaveURL(/to=2026-10-05/);
    await expect(rows(page)).toHaveCount(1);

    await page.reload();
    for (const kept of [/symbol=EURUSD/, /outcome=win/, /range=custom/, /from=2026-10-05/, /to=2026-10-05/]) await expect(page).toHaveURL(kept);
    await expect(page.getByRole("combobox", { name: "Instrument" })).toHaveValue("EURUSD");
    await expect(page.getByRole("combobox", { name: "Outcome" })).toHaveValue("win");
    await expect(page.getByLabel("From date")).toHaveValue("2026-10-05");
    await expect(rows(page)).toHaveCount(1);
    await expect(range(page)).toHaveText("1 to 1 of 1");

    // The winner opened on the 5th, so a window on the 6th holds nothing.
    await page.getByLabel("To date").fill("2026-10-06");
    await page.getByLabel("From date").fill("2026-10-06");
    await expect(page.getByRole("heading", { name: "No trades match" })).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(page).not.toHaveURL(/symbol=|outcome=|range=/);
  });

  test("search narrows the list, stays in the URL, and finds by #id", async ({ page }) => {
    await importCsv(page, SET);
    const search = page.getByLabel("Search trades");
    await search.fill("GBP");
    await expect(page).toHaveURL(/q=GBP/);
    await expect(rows(page)).toHaveCount(2);

    await page.reload();
    await expect(page.getByLabel("Search trades")).toHaveValue("GBP");
    await expect(rows(page)).toHaveCount(2);

    const id = await idOf(rows(page).first());
    await page.getByLabel("Search trades").fill(`#${id}`);
    await expect(rows(page)).toHaveCount(1);
    expect(await idOf(rows(page).first())).toBe(id);

    await page.getByLabel("Search trades").fill("nothing like this");
    await expect(page.getByRole("heading", { name: "No trades match" })).toBeVisible();
  });

  test("sorting by a column orders the rows both ways", async ({ page }) => {
    await importCsv(page, SET);
    const pnl = page.locator("thead").getByRole("button", { name: "P&L" });
    await pnl.click();
    await expect(page).toHaveURL(/sort=pnl&dir=desc|dir=desc.*sort=pnl/);
    await expect(rows(page).first()).toContainText(usd(20));
    await expect(rows(page).last()).toContainText(usd(-10));

    await pnl.click();
    await expect(page).toHaveURL(/dir=asc/);
    await expect(rows(page).first()).toContainText(usd(-10));
    await expect(rows(page).last()).toContainText(usd(20));

    await page.reload();
    await expect(rows(page).first()).toContainText(usd(-10));

    await page.locator("thead").getByRole("button", { name: "Trade" }).click();
    await expect(rows(page).first()).toContainText("GBPUSD");
  });

  test("page size, next and previous page with more rows than fit", async ({ page }) => {
    const many = Array.from({ length: 60 }, (_, i) => `EURUSD,buy,2026-09-${String(1 + (i % 28)).padStart(2, "0")} ${String(8 + (i % 10)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")},2026-10-01 09:00,1.1000,1.1010,1000,,,0`);
    await importCsv(page, many);

    await expect(range(page)).toHaveText("1 to 50 of 60");
    await expect(rows(page)).toHaveCount(50);
    const previous = page.getByRole("button", { name: "Previous" });
    const next = page.getByRole("button", { name: "Next" });
    await expect(previous).toBeDisabled();

    const firstOnPageOne = await idOf(rows(page).first());
    await next.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(range(page)).toHaveText("51 to 60 of 60");
    await expect(rows(page)).toHaveCount(10);
    await expect(next).toBeDisabled();
    await expect(page.locator(`#trade-row-${firstOnPageOne}`)).toHaveCount(0);

    await page.reload();
    await expect(range(page)).toHaveText("51 to 60 of 60");

    await previous.click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(range(page)).toHaveText("1 to 50 of 60");
    await expect(page.locator(`#trade-row-${firstOnPageOne}`)).toHaveCount(1);

    await page.getByLabel("Per page").selectOption("25");
    await expect(page).toHaveURL(/pageSize=25/);
    await expect(rows(page)).toHaveCount(25);
    await expect(range(page)).toHaveText("1 to 25 of 60");
    await next.click();
    await next.click();
    await expect(range(page)).toHaveText("51 to 60 of 60");
    await page.getByLabel("Per page").selectOption("100");
    await expect(rows(page)).toHaveCount(60);
    await expect(page).not.toHaveURL(/page=/);
  });

  test("duplicate adds a copy, delete removes and undo restores", async ({ page }) => {
    await open(page, "/journal");
    await logTrade(page, EURUSD);
    const id = await idOf(row(page, "EURUSD"));

    await page.getByRole("button", { name: `Duplicate trade #${id}` }).click();
    await expect(page.getByText(/Copied as trade #\d+\./)).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(range(page)).toHaveText("1 to 2 of 2");
    for (const line of await rows(page).all()) await expect(line).toContainText(usd(493));

    await page.getByRole("button", { name: `Delete trade #${id}` }).click();
    await expect(page.getByText("Trade deleted.")).toBeVisible();
    await expect(page.locator(`#trade-row-${id}`)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Restored.")).toBeVisible();
    await expect(page.locator(`#trade-row-${id}`)).toHaveCount(1);
    await page.reload();
    await expect(rows(page)).toHaveCount(2);

    // Without undo, the delete sticks.
    await page.getByRole("button", { name: `Delete trade #${id}` }).click();
    await expect(page.locator(`#trade-row-${id}`)).toHaveCount(0);
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
  });
});

test("partial fills through the form: partial, then closed, with the numbers", async ({ page }) => {
  await open(page, "/journal");
  await page.getByRole("button", { name: "Log trade" }).first().click();
  const form = dialog(page);
  await field(form, "Instrument").fill("EURUSD");
  await field(form, "Entry").fill("1.0850");
  await field(form, "Quantity").fill("2");
  await field(form, "Stop").fill("1.0800");
  await field(form, "Contract multiplier").fill("100000");
  await field(form, "Commission").fill("7");
  await form.getByRole("button", { name: /Partial fills/ }).click();
  await form.getByRole("button", { name: "Enter separate fills" }).click();
  await form.getByRole("button", { name: "Add exit" }).click();
  const exit1 = form.locator("ul > li").nth(1);
  await expect(field(exit1, "Size")).toHaveValue("2");
  await field(exit1, "Price").fill("1.0900");
  await field(exit1, "Size").fill("1");
  await expect(figure(form, "Remaining")).toHaveText("1");
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Logged EURUSD.")).toBeVisible();

  // One of two lots out: 0.0050 x 1 x 100000 = 500, less 7 = 493. Risk 0.0050 x 2 x 100000 = 1000, so R 0.493.
  const line = row(page, "EURUSD");
  await expect(line).toContainText("Partial");
  await expect(line).toContainText(usd(493));
  await expect(line).toContainText(r(0.49));
  await page.reload();
  await expect(row(page, "EURUSD")).toContainText("Partial");

  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  let drawer = dialog(page);
  await expect(drawer.getByText("Net P&L realized so far")).toBeVisible();
  await expect(figure(drawer, "Remaining")).toHaveText("1");
  await expect(figure(drawer, "Size")).toHaveText("2 × 100000");
  await expect(drawer.locator("section", { hasText: "Executions" }).locator("tbody tr")).toHaveCount(2);

  await drawer.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = dialog(page);
  await expect(edit.getByRole("heading", { name: /Edit trade/ })).toBeVisible();
  await edit.getByRole("button", { name: "Add exit" }).click();
  const exit2 = edit.locator("ul > li").nth(2);
  await expect(field(exit2, "Size")).toHaveValue("1");
  await field(exit2, "Price").fill("1.0950");
  await expect(figure(edit, "Remaining")).toHaveText("0");
  await edit.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();

  // Second lot: 0.0100 x 100000 = 1000. Gross 1500, net 1493, average exit (1.0900 + 1.0950) / 2 = 1.0925, R 1.493.
  await expect(line).toContainText("Closed");
  await expect(line).toContainText(usd(1493));
  await expect(line).toContainText(r(1.49));
  await page.reload();
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  drawer = dialog(page);
  await expect(figure(drawer, "Remaining")).toHaveText("0");
  await expect(figure(drawer, "Exit")).toHaveText("1.0925");
  await expect(figure(drawer, "Gross P&L")).toHaveText(usd(1500));
  await expect(drawer.locator("section", { hasText: "Executions" }).locator("tbody tr")).toHaveCount(3);
});

test("Analysis and Psychology fields are saved and read back in the drawer", async ({ page }) => {
  await open(page, "/journal");
  await logTrade(page, EURUSD);
  const id = await idOf(row(page, "EURUSD"));
  await page.getByRole("button", { name: `Edit trade #${id}` }).click();
  const form = dialog(page);

  await form.getByRole("button", { name: /^Analysis/ }).click();
  await field(form, "Setup name").fill("London breakout");
  await field(form, "Setup description").fill("Range break after the open");
  await field(form, "Entry reason").fill("Closed above the range");
  await field(form, "Exit reason").fill("Hit the first target");
  await field(form, "Notes").fill("Spread was tight");
  await field(form, "Lessons").fill("Trail sooner next time");
  await field(form, "Feeling before").selectOption("calm");
  await field(form, "Feeling after").selectOption("focused");
  await form.getByRole("button", { name: "late exit" }).click();
  await field(form, "Strategy tags").fill("momentum, london");
  await field(form, "Custom tags").fill("review, A-setup");

  await form.getByRole("button", { name: /^Psychology/ }).click();
  await form.getByRole("radiogroup", { name: "confidence, 1 to 5" }).getByRole("radio", { name: "4" }).click();
  await form.getByRole("radiogroup", { name: "discipline, 1 to 5" }).getByRole("radio", { name: "5" }).click();
  await form.getByRole("radiogroup", { name: "fear, 1 to 5" }).getByRole("radio", { name: "2" }).click();
  await form.getByRole("radiogroup", { name: "greed, 1 to 5" }).getByRole("radio", { name: "1" }).click();
  await form.getByLabel("Early exit").check();
  await field(form, "Rule violations").fill("Added to a winner");
  await field(form, "Followed plan?").selectOption("yes");
  await field(form, "Grade").selectOption("B");

  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();

  await page.reload();
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  const drawer = dialog(page);
  for (const text of ["London breakout", "Range break after the open", "Closed above the range", "Hit the first target", "Spread was tight", "Trail sooner next time", "Feeling before: calm. After: focused.", "late exit", "momentum, london", "review, A-setup", "Early exit", "Added to a winner"]) {
    await expect(drawer.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(figure(drawer, "Confidence")).toHaveText("4 of 5");
  await expect(figure(drawer, "Discipline")).toHaveText("5 of 5");
  await expect(figure(drawer, "Fear")).toHaveText("2 of 5");
  await expect(figure(drawer, "Greed")).toHaveText("1 of 5");
  await expect(figure(drawer, "Followed plan")).toHaveText("Yes");
  await expect(figure(drawer, "Grade")).toHaveText("B");
  // The notes didn't disturb the money.
  await expect(drawer.getByText(usd(493), { exact: true })).toBeVisible();
});

test("journal keys j, k, Enter, x, / and n, and none of them act while typing", async ({ page }) => {
  await importCsv(page, [
    "EURUSD,buy,2026-10-05 09:00,2026-10-05 10:00,1.1000,1.1100,1000,1.0900,,0",
    "GBPUSD,buy,2026-10-06 09:00,2026-10-06 10:00,1.3000,1.3100,1000,1.2900,,0",
    "XAUUSD,buy,2026-10-07 09:00,2026-10-07 10:00,2000,2010,1,1990,,0",
  ]);
  await open(page, "/journal");
  const [first, second] = [rows(page).nth(0), rows(page).nth(1)];
  await expect(first).toBeVisible();
  const firstId = await idOf(first);

  await page.keyboard.press("j");
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("j");
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(first).not.toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(first).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: `Select trade #${firstId}` })).toBeChecked();
  await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: `Select trade #${firstId}` })).not.toBeChecked();

  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("heading", { name: new RegExp(`trade #${firstId}$`) })).toBeVisible();
  // Rows don't move behind an open dialog.
  await page.keyboard.press("j");
  await expect(first).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // "/" focuses search and doesn't type itself.
  await page.keyboard.press("/");
  const search = page.getByLabel("Search trades");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await page.keyboard.type("jkxn");
  await expect(search).toHaveValue("jkxn");
  await expect(dialog(page)).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
  await search.fill("");
  await expect(rows(page)).toHaveCount(3);

  // A select counts as typing too.
  await page.getByRole("combobox", { name: "Outcome" }).focus();
  await page.keyboard.press("n");
  await expect(dialog(page)).toHaveCount(0);

  await search.blur();
  await page.getByRole("combobox", { name: "Outcome" }).blur();
  await page.keyboard.press("n");
  const form = dialog(page);
  await expect(form.getByRole("heading", { name: "Log a trade" })).toBeVisible();
  await expect(field(form, "Instrument")).toBeFocused();
  await page.keyboard.type("nj");
  await expect(field(form, "Instrument")).toHaveValue("nj");
  await expect(first).toHaveAttribute("aria-current", "true");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("Ctrl-K navigates to a screen and finds a trade", async ({ page }) => {
  await open(page, "/journal");
  await logTrade(page, EURUSD);
  const id = await idOf(row(page, "EURUSD"));

  await page.keyboard.press("Control+k");
  const palette = dialog(page);
  await expect(palette.getByRole("heading", { name: "Go to" })).toBeVisible();
  const search = palette.getByLabel("Search screens and trades");
  await expect(search).toBeFocused();
  await search.fill("Reports");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();

  await page.keyboard.press("Control+k");
  await search.fill("eurusd");
  const hit = palette.getByRole("button", { name: new RegExp(`#${id} EURUSD long`) });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText(usd(493));
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("heading", { name: new RegExp(`trade #${id}$`) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // It finds nothing that doesn't exist, and Ctrl-K closes it again.
  await page.keyboard.press("Control+k");
  await search.fill("zzzz");
  await expect(palette.getByText("Nothing matches.")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(dialog(page)).toHaveCount(0);
});

test("a form opened before the accounts arrive still saves into the default account", async ({ page }) => {
  await page.route("**/api/accounts", async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto("/journal");
  await page.getByRole("button", { name: "Log trade" }).first().click();
  const form = dialog(page);
  await expect(form.getByRole("button", { name: "Save trade" })).toBeEnabled();
  await field(form, "Instrument").fill("EURUSD");
  await field(form, "Entry").fill("1.1");
  await field(form, "Quantity").fill("1000");
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Logged EURUSD.")).toBeVisible();
});
