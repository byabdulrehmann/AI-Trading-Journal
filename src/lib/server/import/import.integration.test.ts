import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";

/** Real SQLite file, real zip bytes. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-import-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { dataPath, db } = await import("../db");
const { createUser } = await import("../auth");
const J = await import("../repo/journal");
const { ImportRequest, batchErrorsCsv, commitImport, previewImport } = await import("./service");
const { UploadError } = await import("./errors");
const { readUpload } = await import("./upload");
const { readXlsx, MAX_UNCOMPRESSED_BYTES } = await import("./xlsx");
const { detectTable } = await import("@/lib/domain/import/adapters");
const { MAX_DATA_ROWS, mapRows, parseCsvRows } = await import("@/lib/domain/csv");
const { computePnl } = await import("@/lib/domain/trade-math");

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- helpers ----------

const CONTENT_TYPES = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type XCell = string | number | { f: string; v?: string | number } | { date: number } | null;

function sheetXml(rows: XCell[][]) {
  const col = (i: number) => String.fromCharCode(65 + i);
  const body = rows
    .map((row, r) => {
      const cells = row.map((c, i) => {
        const ref = `${col(i)}${r + 1}`;
        if (c === null) return "";
        if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
        if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(c)}</t></is></c>`;
        if ("date" in c) return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
        const isText = typeof c.v === "string";
        return `<c r="${ref}"${isText ? ' t="str"' : ""}><f>${escapeXml(c.f)}</f>${c.v === undefined ? "" : `<v>${c.v}</v>`}</c>`;
      });
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    })
    .join("");
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function xlsx(sheets: Record<string, XCell[][]>, extra: Zippable = {}): Uint8Array {
  const names = Object.keys(sheets);
  const files: Zippable = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns:r="x"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://x/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>`),
    ...extra,
  };
  names.forEach((n, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[n]))));
  return zipSync(files);
}

const rejects = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof UploadError, `expected UploadError, got ${String(e)}`);
    assert.match(e.message, pattern);
    return true;
  });

const text = (s: string) => strToU8(s);
const csvFile = (s: string, name = "t.csv") => ({ name, bytes: text(s) });
const request = (accountId: number, over: Record<string, unknown> = {}) => ImportRequest.parse({ accountId, ...over });

const HEAD = "symbol,side,open time,close time,entry,exit,qty";
const row = (entry = 1.08, exit = 1.09, minute = "05") => `EURUSD,buy,2026-10-27 09:${minute},2026-10-27 10:40,${entry},${exit},1000`;

/** An MT5 Positions report, laid out as the brief describes: title block, repeated Time and Price, more sections below. */
const MT5_SAMPLE = [
  "Trade History Report",
  "Name:,Test Trader",
  "Account:,12345678 (USD, Demo, Hedge)",
  "Company:,Example Markets",
  "Date:,2026.10.31 18:00",
  "Positions",
  "Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit",
  "2026.10.27 09:05:12,1001,EURUSD,buy,0.10,1.08120,1.07950,1.08500,2026.10.27 10:40:03,1.08410,-0.70,0.00,29.00",
  "2026.10.27 11:00:00,1002,XAUUSD,sell,0.05,2662.50,0.00,0.00,2026.10.27 15:02:44,2668.10,-0.35,-1.20,-28.00",
  "2026.10.28 09:15:00,1003,EURUSD,sell,0.10,1.08500,1.08400,,2026.10.28 10:00:00,1.08300,-0.70,0.25,20.00",
  ",,,,,,,,,,-1.75,-0.95,21.00",
  "Orders",
  "Open Time,Order,Symbol,Type,Volume,Price,S / L,T / P,Time,State,Comment",
  "2026.10.27 09:05:12,5001,EURUSD,buy,0.10 / 0.10,1.08120,,,2026.10.27 09:05:12,filled,",
  "Deals",
  "Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Commission,Fee,Swap,Profit,Balance,Comment",
].join("\n");

let owner: number;
let other: number;
let account: number;
let otherAccount: number;

before(async () => {
  db();
  owner = ((await createUser("owner@example.test", "correct horse battery", "Owner")) as { id: number }).id;
  other = ((await createUser("other@example.test", "correct horse battery", "Other")) as { id: number }).id;
  account = J.createAccount(owner, { name: "Main", broker: "", currency: "USD", startingBalance: 0 }).id;
  otherAccount = J.createAccount(other, { name: "Theirs", broker: "", currency: "USD", startingBalance: 0 }).id;
});

const freshAccount = (name: string) => J.createAccount(owner, { name, broker: "", currency: "USD", startingBalance: 0 }).id;
const storedFiles = () => readdirSync(dataPath("imports"));

// ---------- reading files ----------

describe("xlsx reading", () => {
  test("reads a real workbook, with numbers kept as numbers and blanks in place", () => {
    const { rows, sheets, sheet } = readXlsx(xlsx({ Trades: [["symbol", "qty"], [], ["EURUSD", 1000], [null, 5]] }));
    assert.deepEqual(sheets, ["Trades"]);
    assert.equal(sheet, "Trades");
    assert.deepEqual(rows, [{ line: 1, cells: ["symbol", "qty"] }, { line: 3, cells: ["EURUSD", 1000] }, { line: 4, cells: ["", 5] }]);
  });

  test("offers every sheet and reads the chosen one", () => {
    const file = xlsx({ One: [["a"]], Two: [["b"]] });
    assert.deepEqual(readXlsx(file).sheets, ["One", "Two"]);
    assert.deepEqual(readXlsx(file, "Two").rows[0].cells, ["b"]);
    rejects(() => readXlsx(file, "Three"), /no sheet/);
  });

  test("reads shared strings, rich text and escapes", () => {
    const sst = `<?xml version="1.0"?><sst><si><t>A&amp;B</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>skip</t></rPh></si></sst>`;
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row></sheetData></worksheet>`;
    const file = xlsx({ S: [] }, { "xl/sharedStrings.xml": strToU8(sst) });
    const patched = zipSync({ ...unzipAll(file), "xl/worksheets/sheet1.xml": strToU8(sheet) });
    assert.deepEqual(readXlsx(patched).rows[0].cells, ["A&B", "", "Rich text"]);
  });

  test("a date-styled number becomes wall-clock text, without timezone drift", () => {
    // 46322.5 is 2026-10-27 12:00.
    assert.deepEqual(readXlsx(xlsx({ S: [[{ date: 46322.5 }]] })).rows[0].cells, ["2026-10-27 12:00:00"]);
  });

  test("the 1904 date system is honoured", () => {
    const parts = unzipAll(xlsx({ S: [[{ date: 44860.5 }]] }));
    const workbook = `<workbook xmlns:r="x"><workbookPr date1904="1"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    assert.deepEqual(readXlsx(zipSync({ ...parts, "xl/workbook.xml": strToU8(workbook) })).rows[0].cells, ["2026-10-27 12:00:00"]);
  });

  test("a formula is never evaluated or passed on: only its saved value is read", () => {
    const { rows } = readXlsx(xlsx({ S: [[{ f: "1+1", v: 2 }, { f: 'HYPERLINK("http://evil","x")', v: "x" }, { f: "SUM(A1)" }, "=1+1"]] }));
    assert.deepEqual(rows[0].cells, [2, "x", "", "=1+1"]);
  });

  test("error cells stay text and no number check accepts them", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="e"><v>#REF!</v></c></row></sheetData></worksheet>`;
    assert.deepEqual(readXlsx(zipSync({ ...unzipAll(xlsx({ S: [] })), "xl/worksheets/sheet1.xml": strToU8(sheet) })).rows[0].cells, ["#REF!"]);
  });
});

const unzipAll = (bytes: Uint8Array): Zippable => unzipSync(bytes);

describe("rejecting bad uploads", () => {
  test("a corrupt zip", () => {
    const bytes = xlsx({ S: [["a"]] });
    rejects(() => readUpload("t.xlsx", bytes.slice(0, 60)), /damaged/);
  });

  test("a renamed non-xlsx, by content", () => {
    rejects(() => readUpload("t.xlsx", text("symbol,side\nEURUSD,buy")), /isn't an Excel workbook/);
    rejects(() => readUpload("t.xlsx", zipSync({ "readme.txt": text("hello") })), /not an Excel workbook/);
  });

  test("an xlsx renamed to csv", () => {
    rejects(() => readUpload("t.csv", xlsx({ S: [["a"]] })), /named \.csv/);
  });

  test("legacy .xls by content and by name", () => {
    rejects(() => readUpload("t.xlsx", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), /\.xls/);
    rejects(() => readUpload("t.csv", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), /\.xls/);
    rejects(() => readUpload("t.xls", text("a,b")), /\.xls/);
  });

  test("macro-enabled files, by name, by entry and by declared type", () => {
    rejects(() => readUpload("t.xlsm", xlsx({ S: [["a"]] })), /Macro/);
    rejects(() => readUpload("t.xlsx", xlsx({ S: [["a"]] }, { "xl/vbaProject.bin": new Uint8Array([1]) })), /Macro/);
    const macro = CONTENT_TYPES.replace("sheet.main+xml", "sheet.main+xml").replace("</Types>", `<Default Extension="bin" ContentType="application/vnd.ms-office.macroEnabled"/></Types>`);
    rejects(() => readUpload("t.xlsx", zipSync({ ...unzipAll(xlsx({ S: [["a"]] })), "[Content_Types].xml": strToU8(macro) })), /Macro/);
  });

  test("binary junk, other extensions, web pages and empty files", () => {
    rejects(() => readUpload("t.csv", new Uint8Array([1, 2, 3, 0, 255, 254, 7])), /binary/);
    rejects(() => readUpload("t.exe", text("a,b")), /\.csv or \.xlsx/);
    rejects(() => readUpload("t.csv", text("<!DOCTYPE html><html></html>")), /web page/);
    rejects(() => readUpload("t.csv", new Uint8Array()), /empty/);
    rejects(() => readUpload("t.csv", new Uint8Array(10_000_001).fill(97)), /10 MB/);
  });

  test("a zip bomb, by declared size", () => {
    const big = new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1000).fill(32);
    const bomb = zipSync({ ...unzipAll(xlsx({ S: [["a"]] })), "xl/media/huge.bin": [big, { level: 1 }] });
    assert.ok(bomb.length < 10_000_000, "the bomb itself fits inside the upload limit");
    rejects(() => readUpload("t.xlsx", bomb), /too much data/);
  });

  test("one enormous shared string is refused rather than copied row by row", () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const huge = zipSync({ ...unzipAll(xlsx({ S: [] })), "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(`<sst><si><t>${"x".repeat(40000)}</t></si></sst>`) });
    rejects(() => readUpload("t.xlsx", huge), /damaged/);
  });

  test("a zip bomb lying about its size is cut off and rejected", () => {
    const pad = new Uint8Array(5_000_000).fill(32);
    const inner = strToU8(`<worksheet><sheetData>`);
    const whole = new Uint8Array(inner.length + pad.length);
    whole.set(inner);
    whole.set(pad, inner.length);
    const entries = { ...unzipAll(xlsx({ S: [["a"]] })), "xl/worksheets/sheet1.xml": whole };
    const lying = zipSync(entries);
    // Rewrite that entry's declared size in the central directory to 1 byte.
    const view = new DataView(lying.buffer, lying.byteOffset, lying.byteLength);
    const name = "xl/worksheets/sheet1.xml";
    for (let i = 0; i < lying.length - 46; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const nameLength = view.getUint16(i + 28, true);
      if (new TextDecoder().decode(lying.subarray(i + 46, i + 46 + nameLength)) === name) view.setUint32(i + 24, 1, true);
    }
    rejects(() => readUpload("t.xlsx", lying), /damaged/);
  });

  test("a DTD is refused, not expanded", () => {
    const hostile = `<!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&a;</t></is></c></row></sheetData></worksheet>`;
    rejects(() => readUpload("t.xlsx", zipSync({ ...unzipAll(xlsx({ S: [] })), "xl/worksheets/sheet1.xml": strToU8(hostile) })), /damaged/);
  });

  test("too many rows: CSV, XLSX and the trade limit", () => {
    const many = (n: number) => HEAD + "\n" + Array.from({ length: n }, () => row()).join("\n");
    rejects(() => readUpload("t.csv", text(many(MAX_DATA_ROWS + 200))), /too many rows/);
    const rows: XCell[][] = Array.from({ length: MAX_DATA_ROWS + 200 }, (_, i) => [i]);
    rejects(() => readUpload("t.xlsx", xlsx({ S: rows })), /too many rows/);
    rejects(() => previewImport(owner, csvFile(many(MAX_DATA_ROWS + 1)), request(account)), /20,000/);
  });

  test("a far-off column can't balloon memory", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="XFD1"><v>1</v></c></row></sheetData></worksheet>`;
    rejects(() => readUpload("t.xlsx", zipSync({ ...unzipAll(xlsx({ S: [] })), "xl/worksheets/sheet1.xml": strToU8(sheet) })), /columns/);
  });

  test("a quote that never closes stops the read rather than swallowing rows", () => {
    rejects(() => readUpload("t.csv", text(`${HEAD}\n"EURUSD,buy\n${row()}`)), /Line 2/);
  });
});

describe("text encodings and layout", () => {
  test("UTF-16 with a BOM, as MT5 can save", () => {
    const body = Buffer.from(`﻿${HEAD}\n${row()}`, "utf16le");
    assert.equal(readUpload("t.csv", new Uint8Array(body)).rows.length, 2);
  });

  test("semicolon files with decimal commas", () => {
    const file = csvFile(`symbol;side;open time;close time;entry;exit;qty\nEURUSD;buy;2026-10-27 09:05;2026-10-27 10:40;1,0850;1,0900;1000`);
    const p = previewImport(owner, file, request(account, { numberFormat: "comma" }));
    assert.equal(p.valid, 1);
    assert.equal(p.preview[0].trade?.entryPrice, 1.085);
  });

  test("line numbers survive blank lines and quoted newlines", () => {
    const rows = parseCsvRows(`a,b\n\n"x\ny",1\n\n\nz,2`);
    assert.deepEqual(rows.map((r) => r.line), [1, 3, 7]);
  });

  test("a numeric XLSX cell isn't caught by the comma format", () => {
    const bytes = xlsx({ S: [HEAD.split(","), ["EURUSD", "buy", "2026-10-27 09:05", "2026-10-27 10:40", 1.085, 1.09, 1000]] });
    const p = previewImport(owner, { name: "t.xlsx", bytes }, request(account, { numberFormat: "comma" }));
    assert.equal(p.preview[0].trade?.entryPrice, 1.085);
  });
});

// ---------- adapters ----------

describe("adapters", () => {
  const rowsOf = (s: string) => parseCsvRows(s);

  test("maps by index when headers repeat", () => {
    const [h, r] = parseCsvRows("Time,Symbol,Type,Volume,Price,Time,Price\n2026-10-27 09:05,EURUSD,buy,1,1.08,2026-10-27 10:40,1.09");
    const table = detectTable([h, r]);
    assert.equal(table.adapter, "mt5-history");
    assert.equal(table.mapping.openedAt, 0);
    assert.equal(table.mapping.closedAt, 5);
    assert.equal(table.mapping.entryPrice, 4);
    assert.equal(table.mapping.exitPrice, 6);
    const [res] = mapRows(table.rows.map((x) => x.cells), table.mapping, 1);
    assert.equal(res.trade?.entryPrice, 1.08);
    assert.equal(res.trade?.exitPrice, 1.09);
  });

  test("MT5: finds the table under the title, stops before Orders, reads every field", () => {
    const table = detectTable(rowsOf(MT5_SAMPLE));
    assert.equal(table.adapter, "mt5-history");
    assert.equal(table.matched, true);
    assert.equal(table.headerLine, 7);
    assert.equal(table.rows.length, 4); // Three positions and the totals line.
    assert.equal(table.trailingRows, 5);
  });

  test("MT5 end to end: costs, signs, stops at 0, totals line reported, profit agrees", () => {
    const acct = freshAccount("MT5");
    const p = previewImport(owner, csvFile(MT5_SAMPLE), request(acct, { contractSizes: { EURUSD: 100000, XAUUSD: 100 } }));
    assert.equal(p.adapter, "mt5-history");
    assert.deepEqual([p.total, p.valid, p.invalid, p.duplicates], [4, 3, 1, 0]);
    assert.match(p.errors[0].errors[0], /totals line/);
    assert.equal(p.errors[0].line, 11);
    assert.equal(p.mismatches, 0);
    const [eur, xau] = p.preview;
    assert.equal(eur.trade?.quantity, 0.1);
    assert.equal(eur.trade?.commission, 0.7);
    assert.equal(eur.trade?.stopPrice, 1.0795);
    assert.equal(xau.trade?.side, "short");
    assert.equal(xau.trade?.stopPrice, null); // 0 means no stop, and must not fail a short.
    assert.equal(xau.trade?.swap, 1.2);
    assert.equal(p.feesMapped, true);
    const { batch } = commitImport(owner, csvFile(MT5_SAMPLE), request(acct, { contractSizes: { EURUSD: 100000, XAUUSD: 100 } }));
    const stored = J.listTrades(owner, { accountId: acct });
    assert.equal(stored.length, 3);
    assert.deepEqual(new Set(db().prepare("SELECT source_key FROM trades WHERE import_batch = ?").all(batch).map((r) => (r as { source_key: string }).source_key)), new Set(["ticket:1001", "ticket:1002", "ticket:1003"]));
  });

  test("a trailed stop past entry is left out and flagged, not an error", () => {
    const sample = MT5_SAMPLE.replace("1.08500,1.08400,,", "1.08500,1.08400,,").replace("buy,0.10,1.08120,1.07950", "buy,0.10,1.08120,1.08200");
    const p = previewImport(owner, csvFile(sample), request(account, { contractSizes: { EURUSD: 100000, XAUUSD: 100 } }));
    assert.equal(p.preview[0].trade?.stopPrice, null);
    assert.match(p.preview[0].warnings?.[0] ?? "", /wrong side/);
  });

  test("MT5 as a real XLSX", () => {
    const rows: XCell[][] = parseCsvRows(MT5_SAMPLE).map((r) => r.cells.map((c) => (c !== "" && !Number.isNaN(Number(c)) ? Number(c) : c)));
    const p = previewImport(owner, { name: "report.xlsx", bytes: xlsx({ Sheet1: rows }) }, request(account, { contractSizes: { EURUSD: 100000, XAUUSD: 100 } }));
    assert.equal(p.format, "xlsx");
    assert.equal(p.adapter, "mt5-history");
    assert.equal(p.valid + p.invalid + p.duplicates, p.total);
    assert.equal(p.total, 4);
  });

  test("cTrader-style headers, with a zone and a currency in them", () => {
    const csv = "Position ID,Symbol,Direction,Opening Time (UTC+3),Closing Time (UTC+3),Entry Price,Closing Price,Closing Quantity,Commissions,Swap,Net USD\n77,EURUSD,Buy,2026-10-27 09:05,2026-10-27 10:40,1.08,1.09,1000,-1,0,9";
    const p = previewImport(owner, csvFile(csv), request(account));
    assert.equal(p.adapter, "ctrader");
    assert.equal(p.valid, 1);
    assert.equal(p.mismatches, 0);
  });

  test("the user can override detection, and a poor match says so", () => {
    const p = previewImport(owner, csvFile(MT5_SAMPLE), request(account, { adapter: "generic" }));
    assert.equal(p.adapter, "generic");
    assert.equal(p.adapterMatched, false);
    const q = previewImport(owner, csvFile(`${HEAD}\n${row()}`), request(account, { adapter: "mt5-history" }));
    assert.equal(q.adapterMatched, false);
  });

  test("a generic file is generic", () => {
    assert.equal(previewImport(owner, csvFile(`${HEAD}\n${row()}`), request(account)).adapter, "generic");
  });
});

describe("broker profit check", () => {
  const withProfit = (profit: string, over = {}) => previewImport(owner, csvFile(`${HEAD},profit\n${row()},${profit}`), request(account, over));

  test("agreeing within 1% isn't flagged; the calculation is kept", () => {
    const p = withProfit("10.05");
    assert.equal(p.mismatches, 0);
    assert.equal(computePnl(p.preview[0].trade!), 10);
  });

  test("a wrong contract size is flagged, in the preview only", () => {
    const p = withProfit("1000");
    assert.equal(p.mismatches, 1);
    assert.match(p.flagged[0].warnings?.[0] ?? "", /contract size/);
    assert.equal(p.valid, 1);
    assert.equal(computePnl(p.preview[0].trade!), 10);
  });

  test("the right contract size clears the flag", () => {
    assert.equal(withProfit("1000", { contractSizes: { EURUSD: 100 } }).mismatches, 0);
  });

  test("an unreadable profit warns but keeps the row", () => {
    const p = withProfit("abc");
    assert.equal(p.valid, 1);
    assert.equal(p.mismatches, 0);
    assert.match(p.flagged[0].warnings?.[0] ?? "", /wasn't compared/);
  });
});

describe("mapping choices", () => {
  test("symbol and direction mapping", () => {
    const csv = `${HEAD}\nEURUSD.M,achat,2026-10-27 09:05,2026-10-27 10:40,1.08,1.09,1`;
    const before = previewImport(owner, csvFile(csv), request(account));
    assert.equal(before.valid, 0);
    assert.deepEqual(before.unknownSides, ["achat"]);
    const p = previewImport(owner, csvFile(csv), request(account, { symbolMap: { "EURUSD.M": "EURUSD" }, sideMap: { achat: "long" }, contractSizes: { "EURUSD.M": 100000 } }));
    assert.equal(p.preview[0].trade?.symbol, "EURUSD");
    assert.equal(p.preview[0].trade?.side, "long");
    assert.equal(p.preview[0].trade?.multiplier, 100000);
    assert.deepEqual(p.unknownSides, []);
  });

  test("a contract size used before is offered again", () => {
    const acct = freshAccount("Remember");
    commitImport(owner, csvFile(`${HEAD}\n${row()}`), request(acct, { contractSizes: { EURUSD: 100000 } }));
    const p = previewImport(owner, csvFile(`${HEAD}\n${row(1.1, 1.2)}`), request(acct));
    assert.equal(p.preview[0].trade?.multiplier, 100000);
    assert.deepEqual(p.symbols, [{ symbol: "EURUSD", contractSize: 100000 }]);
  });
});

// ---------- wrong types and formulas in text ----------

describe("wrong types and formula text", () => {
  test("text in a number column and a number in a date column are invalid rows", () => {
    const bytes = xlsx({ S: [HEAD.split(","), ["EURUSD", "buy", 46322.5, null, "abc", null, 1000], ["EURUSD", "buy", "2026-10-27 09:05", null, 1.08, null, "#N/A"]] });
    const p = previewImport(owner, { name: "t.xlsx", bytes }, request(account));
    assert.equal(p.invalid, 2);
    assert.match(p.errors[0].errors.join(), /Open time "46322.5" isn't a date/);
    assert.match(p.errors[0].errors.join(), /Entry price "abc"/);
    assert.match(p.errors[1].errors.join(), /Size \/ quantity "#N\/A"/);
  });

  test("a bare number in a CSV date column isn't read as a year", () => {
    const p = previewImport(owner, csvFile(`symbol,side,open time,entry,qty\nEURUSD,buy,12,1.08,1`), request(account));
    assert.equal(p.invalid, 1);
  });

  test("formula-looking symbols are invalid; formula-looking notes stay literal text", () => {
    const csv = `symbol,side,open time,close time,entry,exit,qty,notes\n=cmd|'/c calc'!A1,buy,2026-10-27 09:05,2026-10-27 10:40,1.08,1.09,1,hello\nEURUSD,buy,2026-10-27 09:05,2026-10-27 10:40,1.08,1.09,1,=1+1`;
    const acct = freshAccount("Formula");
    const r = commitImport(owner, csvFile(csv), request(acct));
    assert.equal(r.invalid, 1);
    assert.equal(J.listTrades(owner, { accountId: acct })[0].notes, "=1+1");
  });

  test("the invalid-rows download defuses formulas", () => {
    const csv = `${HEAD}\n=HYPERLINK("http://evil"),buy,x,y,1,2,3`;
    const acct = freshAccount("Defuse");
    const r = commitImport(owner, csvFile(`${csv}\n${row()}`), request(acct));
    const out = batchErrorsCsv(owner, r.batch)!;
    assert.match(out, /^line,reason,row\r\n2,/);
    const rawCell = out.split("\r\n")[1];
    assert.ok(rawCell.includes(",'=HYPERLINK"), rawCell);
  });
});

// ---------- duplicates ----------

describe("duplicates", () => {
  test("re-importing a file finds every row; tickets give stable keys", () => {
    const acct = freshAccount("Dup");
    const file = csvFile(`ticket,${HEAD}\n9,${row()}\n10,${row(1.2, 1.3)}`);
    const first = commitImport(owner, file, request(acct));
    assert.equal(first.imported, 2);
    const again = previewImport(owner, file, request(acct));
    assert.deepEqual([again.total, again.valid, again.duplicates, again.invalid], [2, 0, 2, 0]);
    assert.deepEqual(again.duplicateLines, [2, 3]);
    rejects(() => commitImport(owner, file, request(acct)), /No valid rows/);
  });

  test("identical rows in one file are all kept, numbered, and all found on re-import", () => {
    const acct = freshAccount("Occurrence");
    const file = csvFile(`${HEAD}\n${row()}\n${row()}\n${row()}`);
    const { imported, batch } = commitImport(owner, file, request(acct));
    assert.equal(imported, 3);
    const keys = db().prepare("SELECT source_key FROM trades WHERE import_batch = ?").all(batch).map((r) => (r as { source_key: string }).source_key);
    assert.equal(new Set(keys).size, 3);
    assert.equal(previewImport(owner, file, request(acct)).duplicates, 3);
  });

  test("a later file with one more identical fill adds only that fill", () => {
    const acct = freshAccount("MoreFills");
    commitImport(owner, csvFile(`${HEAD}\n${row()}`), request(acct));
    const p = previewImport(owner, csvFile(`${HEAD}\n${row()}\n${row()}`), request(acct));
    assert.deepEqual([p.valid, p.duplicates], [1, 1]);
  });

  test("the same time alone is not a duplicate", () => {
    const acct = freshAccount("SameTime");
    commitImport(owner, csvFile(`${HEAD}\n${row(1.08, 1.09)}`), request(acct));
    const p = previewImport(owner, csvFile(`${HEAD}\n${row(1.08, 1.1)}`), request(acct));
    assert.deepEqual([p.valid, p.duplicates], [1, 0]);
  });

  test("a ticket repeated in a file is listed, not guessed at", () => {
    const p = previewImport(owner, csvFile(`ticket,${HEAD}\n9,${row()}\n9,${row(1.2, 1.3)}`), request(freshAccount("Repeat")));
    assert.deepEqual([p.valid, p.invalid, p.duplicates], [1, 1, 0]);
    assert.match(p.errors[0].errors[0], /line 2/);
  });

  test("duplicates are per account", () => {
    const [a, b] = [freshAccount("A"), freshAccount("B")];
    const file = csvFile(`${HEAD}\n${row()}`);
    commitImport(owner, file, request(a));
    assert.equal(previewImport(owner, file, request(b)).valid, 1);
  });

  test("an undone batch can be imported again", () => {
    const acct = freshAccount("Undo");
    const file = csvFile(`ticket,${HEAD}\n9,${row()}\n,${row()}`);
    const { batch } = commitImport(owner, file, request(acct));
    assert.equal(J.undoImport(owner, batch), 2);
    assert.equal(J.listTrades(owner, { accountId: acct }).length, 0);
    assert.equal(commitImport(owner, file, request(acct)).imported, 2);
  });

  test("a trade the user deleted counts as present, so re-import can't trip the unique index", () => {
    const acct = freshAccount("Deleted");
    const file = csvFile(`${HEAD}\n${row()}`);
    commitImport(owner, file, request(acct));
    J.setTradesDeleted(owner, J.listTrades(owner, { accountId: acct }).map((t) => t.id), true);
    const p = previewImport(owner, file, request(acct));
    assert.deepEqual([p.valid, p.duplicates], [0, 1]);
  });
});

// ---------- commit ----------

describe("commit", () => {
  test("preview writes nothing", () => {
    const acct = freshAccount("Preview");
    const files = storedFiles().length;
    const batches = J.listImports(owner).length;
    previewImport(owner, csvFile(`${HEAD}\n${row()}`), request(acct));
    assert.equal(J.listTrades(owner, { accountId: acct }).length, 0);
    assert.equal(storedFiles().length, files);
    assert.equal(J.listImports(owner).length, batches);
  });

  test("counts add up, invalid rows are stored with line and reason, the original is kept with its hash", () => {
    const acct = freshAccount("Counts");
    const content = `ticket,${HEAD}\n1,${row()}\n\n2,EURUSD,sideways,2026-10-27 09:05,2026-10-27 10:40,1.08,1.09,1\n3,${row(1.1, 1.2)}`;
    commitImport(owner, csvFile(`ticket,${HEAD}\n1,${row()}`), request(acct));
    const r = commitImport(owner, csvFile(content, "history.csv"), request(acct));
    assert.deepEqual([r.total, r.imported, r.duplicates, r.invalid], [3, 1, 1, 1]);
    assert.equal(r.imported + r.duplicates + r.invalid, r.total);
    assert.equal(r.errors[0].line, 4); // The blank line counts, as it does when the file is opened.
    const b = db().prepare("SELECT * FROM import_batches WHERE id = ?").get(r.batch) as Record<string, string | number>;
    assert.equal(b.filename, "history.csv");
    assert.equal(b.total_rows, 3);
    assert.equal(b.imported, 1);
    assert.equal(b.duplicates, 1);
    assert.equal(b.invalid, 1);
    assert.match(JSON.parse(b.errors as string)[0].errors[0], /sideways/);
    assert.match(b.stored_name as string, /^[0-9a-f-]{36}\.csv$/);
    assert.equal(readFileSync(path.join(dataPath("imports"), b.stored_name as string), "utf8"), content);
    assert.match(b.file_sha256 as string, /^[0-9a-f]{64}$/);
  });

  test("a row failing inside the transaction rolls back every row, the batch and the stored file", () => {
    const acct = freshAccount("Rollback");
    db().exec(`CREATE TRIGGER boom BEFORE INSERT ON trades WHEN NEW.symbol = 'BOOM' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    try {
      const files = storedFiles().length;
      const batches = J.listImports(owner).length;
      const file = csvFile(`${HEAD}\n${row()}\n${row(1.2, 1.3)}\nBOOM,buy,2026-10-27 09:05,2026-10-27 10:40,1,2,1`);
      assert.throws(() => commitImport(owner, file, request(acct)), /boom/);
      assert.equal(J.listTrades(owner, { accountId: acct }).length, 0);
      assert.equal(J.listImports(owner).length, batches);
      assert.equal(storedFiles().length, files);
    } finally {
      db().exec("DROP TRIGGER boom");
    }
  });
});

// ---------- users ----------

describe("user isolation", () => {
  const file = () => csvFile(`${HEAD}\n${row()}`);

  test("another user's account can't be previewed or imported into", () => {
    rejects(() => previewImport(owner, file(), request(otherAccount)), /doesn't exist/);
    rejects(() => commitImport(owner, file(), request(otherAccount)), /doesn't exist/);
    assert.equal(J.listTrades(other, { accountId: otherAccount }).length, 0);
  });

  test("history, error downloads and undo stay with their owner", () => {
    const acct = freshAccount("Mine");
    const { batch } = commitImport(owner, csvFile(`${HEAD}\n${row()}\nbad`), request(acct));
    assert.ok((J.listImports(owner) as { id: string }[]).some((b) => b.id === batch));
    assert.ok(!(J.listImports(other) as { id: string }[]).some((b) => b.id === batch));
    assert.equal(batchErrorsCsv(other, batch), null);
    assert.ok(batchErrorsCsv(owner, batch));
    assert.equal(J.undoImport(other, batch), 0);
    assert.equal(J.listTrades(owner, { accountId: acct }).length, 1);
  });

  test("the same file for two users doesn't collide", () => {
    const p = previewImport(other, file(), request(otherAccount));
    assert.deepEqual([p.valid, p.duplicates], [1, 0]);
  });
});
