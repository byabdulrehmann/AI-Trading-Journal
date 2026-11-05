import { zipSync, strToU8 } from "fflate";
import { CSV_HEAD, csvFile, dialog, expect, figure, open, r, range, row, rows, test, usd } from "./helpers";

const FILE_LABEL = "File (drop it here or browse)";

// Lots. EURUSD: 0.0050 x 1 x 100000 = 500, less 7 = 493, R 493 / 500. GBPUSD short: 0.0050 x 2 x 100000 = 1000, less 10 = 990, R 990 / 1000.
const EURUSD = "EURUSD,buy,2026-10-12 09:00,2026-10-12 10:00,1.0850,1.0900,1,1.0800,1.0950,7";
const GBPUSD = "GBPUSD,sell,2026-10-13 09:00,2026-10-13 10:00,1.3000,1.2950,2,1.3050,,10";
const LATER = "EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.0850,1.0900,1,1.0800,,7";

test("CSV: preview, contract size, import, duplicates skipped, undo", async ({ page }) => {
  await open(page, "/journal");
  await page.getByRole("button", { name: "Import" }).first().click();
  await expect(page).toHaveURL(/import=1/);
  const box = dialog(page);
  const symbols = box.getByRole("region", { name: "Symbols" });

  await box.getByLabel(FILE_LABEL).setInputFiles(csvFile("first.csv", [CSV_HEAD, EURUSD, GBPUSD].join("\n")));
  await expect(figure(box, "Ready")).toHaveText("2");
  await expect(figure(box, "With problems")).toHaveText("0");
  await expect(figure(box, "Already imported")).toHaveText("0");
  await expect(figure(box, "Rows in the file")).toHaveText("2");
  const preview = box.locator("table", { hasText: "Rows that will be imported" });
  await expect(preview.locator("tbody tr")).toHaveCount(2);
  await expect(preview.locator("tbody tr").first()).toContainText("EURUSD");

  // Multiplier 1 reads lots as units, so nothing is imported until the size is right.
  const sizeOf = (symbol: string) => symbols.locator("div.grid.grid-cols-2").filter({ hasText: `${symbol}: store as` }).getByLabel("Contract size");
  await sizeOf("EURUSD").fill("100000");
  await sizeOf("EURUSD").blur();
  // GBPUSD still at size 1: 0.0050 x 2 x 1 = 0.01, less 10 = -9.99.
  await expect(figure(box, "Net P&L of ready rows")).toHaveText(usd(483.01));
  await sizeOf("GBPUSD").fill("100000");
  await sizeOf("GBPUSD").blur();
  await expect(figure(box, "Net P&L of ready rows")).toHaveText(usd(1483));
  await expect(preview.locator("tbody tr").first()).toContainText(usd(493));

  await box.getByRole("button", { name: "Import 2 trades" }).click();
  await expect(figure(box, "Imported")).toHaveText("2");
  await box.getByRole("button", { name: "Done" }).click();

  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, "EURUSD")).toContainText(usd(493));
  await expect(row(page, "EURUSD")).toContainText(r(0.99));
  await expect(row(page, "EURUSD")).toContainText("Imported");
  await expect(row(page, "GBPUSD")).toContainText(usd(990));
  await expect(row(page, "GBPUSD")).toContainText(r(0.99));
  await row(page, "GBPUSD").getByRole("button", { name: "GBPUSD" }).click();
  await expect(figure(dialog(page), "Size")).toHaveText("2 × 100000");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // The same file again: everything is a duplicate, so there's nothing to press.
  await page.getByRole("button", { name: "Import" }).first().click();
  await box.getByLabel(FILE_LABEL).setInputFiles(csvFile("first.csv", [CSV_HEAD, EURUSD, GBPUSD].join("\n")));
  await expect(figure(box, "Already imported")).toHaveText("2");
  await expect(figure(box, "Ready")).toHaveText("0");
  await expect(box.getByText("Already imported, skipped: line 2, 3.")).toBeVisible();
  await expect(box.getByRole("button", { name: "Import 0 trades" })).toBeDisabled();

  // One new row among the old: only it comes in, and the summary says so.
  await box.getByLabel(FILE_LABEL).setInputFiles(csvFile("second.csv", [CSV_HEAD, EURUSD, GBPUSD, LATER].join("\n")));
  await expect(figure(box, "Ready")).toHaveText("1");
  await expect(figure(box, "Already imported")).toHaveText("2");
  await box.getByRole("button", { name: "Import 1 trades" }).click();
  await expect(figure(box, "Imported")).toHaveText("1");
  await expect(figure(box, "Already imported")).toHaveText("2");
  await expect(range(page)).toHaveText("1 to 3 of 3");

  await box.getByRole("button", { name: "Undo this import" }).click();
  await expect(page.getByText("Import removed: 1 trades.")).toBeVisible();
  await expect(range(page)).toHaveText("1 to 2 of 2");

  // The first batch undoes from the history.
  await box.getByRole("button", { name: "Undo import of first.csv" }).click();
  await expect(page.getByText("Import removed: 2 trades.")).toBeVisible();
  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Your journal is empty" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your journal is empty" })).toBeVisible();

  // Undone trades no longer count as duplicates.
  await page.getByRole("button", { name: "Import" }).first().click();
  await box.getByLabel(FILE_LABEL).setInputFiles(csvFile("first.csv", [CSV_HEAD, EURUSD, GBPUSD].join("\n")));
  await expect(figure(box, "Ready")).toHaveText("2");
});

/** A real workbook: a zip with inline strings, numbers, and dates stored as serials under a date style, the way Excel writes them. */
function workbook(sheet: (string | number | { date: Date })[][]) {
  const column = (i: number) => String.fromCharCode(65 + i);
  const cell = (v: string | number | { date: Date }, ref: string) => {
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === "string") return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    return `<c r="${ref}" s="1"><v>${v.date.getTime() / 86400000 + 25569}</v></c>`;
  };
  const rowsXml = sheet.map((cells, y) => `<row r="${y + 1}">${cells.map((v, x) => cell(v, `${column(x)}${y + 1}`)).join("")}</row>`).join("");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>';
  const main = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(`${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
      "_rels/.rels": strToU8(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      "xl/workbook.xml": strToU8(`${xml}<workbook ${main} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trades" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
      "xl/styles.xml": strToU8(`${xml}<styleSheet ${main}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>`),
      "xl/worksheets/sheet1.xml": strToU8(`${xml}<worksheet ${main}><sheetData>${rowsXml}</sheetData></worksheet>`),
    }),
  );
}

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("XLSX: a generated workbook previews, imports and keeps its dates and figures", async ({ page }) => {
  const at = (day: number, hour: number) => ({ date: new Date(Date.UTC(2026, 9, day, hour)) });
  const file = workbook([
    ["symbol", "side", "open time", "close time", "entry", "exit", "qty", "stop", "target", "commission"],
    ["EURUSD", "buy", at(14, 9), at(14, 10), 1.085, 1.09, 1, 1.08, 1.095, 7],
    ["XAUUSD", "sell", at(15, 14), at(15, 15), 2000, 1990, 1, 2010, "", 3],
  ]);
  await open(page, "/journal?import=1");
  const box = dialog(page);
  await box.getByLabel(FILE_LABEL).setInputFiles({ name: "history.xlsx", mimeType: XLSX, buffer: file });
  await expect(figure(box, "Ready")).toHaveText("2");
  await expect(figure(box, "Rows in the file")).toHaveText("2");

  const symbols = box.getByRole("region", { name: "Symbols" });
  const eurusd = symbols.locator("div.grid.grid-cols-2").filter({ hasText: "EURUSD: store as" }).getByLabel("Contract size");
  await eurusd.fill("100000");
  await eurusd.blur();
  // EURUSD as above, 493. XAUUSD short at size 1: 10 x 1 x 1 = 10, less 3 = 7.
  await expect(figure(box, "Net P&L of ready rows")).toHaveText(usd(500));

  await box.getByRole("button", { name: "Import 2 trades" }).click();
  await expect(figure(box, "Imported")).toHaveText("2");
  await box.getByRole("button", { name: "Done" }).click();

  await expect(row(page, "EURUSD")).toContainText(usd(493));
  await expect(row(page, "EURUSD")).toContainText(r(0.99));
  await expect(row(page, "XAUUSD")).toContainText(usd(7));
  const { trades } = await (await page.request.get("/api/trades")).json();
  const eur = trades.find((t: { symbol: string }) => t.symbol === "EURUSD");
  expect(new Date(eur.openedAt).getTime()).toBe(new Date(2026, 9, 14, 9).getTime());
  expect(new Date(eur.closedAt).getTime()).toBe(new Date(2026, 9, 14, 10).getTime());

  // The same workbook twice is a duplicate too.
  await page.getByRole("button", { name: "Import" }).first().click();
  await box.getByLabel(FILE_LABEL).setInputFiles({ name: "history.xlsx", mimeType: XLSX, buffer: file });
  await expect(figure(box, "Already imported")).toHaveText("2");
  await expect(figure(box, "Ready")).toHaveText("0");
});

test("a corrupt file shows an error and imports nothing", async ({ page, guard }) => {
  guard.allow(/status of 4\d\d/);
  await open(page, "/journal?import=1");
  const box = dialog(page);

  await box.getByLabel(FILE_LABEL).setInputFiles({ name: "broken.xlsx", mimeType: XLSX, buffer: Buffer.from("this is not a workbook") });
  await expect(box.getByRole("alert")).toContainText("isn't an Excel workbook");
  await expect(box.getByRole("button", { name: "Import", exact: true })).toBeDisabled();

  await box.getByLabel(FILE_LABEL).setInputFiles({ name: "cut.xlsx", mimeType: XLSX, buffer: workbook([["symbol"], ["EURUSD"]]).subarray(0, 200) });
  await expect(box.getByRole("alert")).toContainText("damaged or incomplete");

  await box.getByLabel(FILE_LABEL).setInputFiles({ name: "other.xlsx", mimeType: XLSX, buffer: Buffer.from(zipSync({ "notes.txt": strToU8("hello") })) });
  await expect(box.getByRole("alert")).toContainText("not an Excel workbook");

  // A good file after a bad one clears the error.
  await box.getByLabel(FILE_LABEL).setInputFiles(csvFile("good.csv", [CSV_HEAD, LATER].join("\n")));
  await expect(figure(box, "Ready")).toHaveText("1");
  await expect(box.getByRole("alert")).toHaveCount(0);

  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Your journal is empty" })).toBeVisible();
});
