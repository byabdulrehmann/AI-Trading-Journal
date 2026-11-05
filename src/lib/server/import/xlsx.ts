import "server-only";
import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync } from "fflate";
import { MAX_SHEET_ROWS, type Cell, type SheetRow } from "@/lib/domain/csv";
import { UploadError } from "./errors";

export const MAX_UNCOMPRESSED_BYTES = 100_000_000;
const MAX_ZIP_ENTRIES = 2000;
const MAX_COLUMNS = 500;
/** Excel's own limit for one cell. */
const MAX_CELL_CHARS = 32767;
const INFLATE_STEP_BYTES = 64 * 1024;

const CORRUPT = "This .xlsx file is damaged or incomplete. Open it in Excel, save it again and retry.";
const NOT_WORKBOOK = "This file is a zip, but not an Excel workbook. Export your history as .xlsx or .csv.";
const TOO_BIG = "This workbook expands to too much data to read safely.";
const MACROS = "Macro-enabled workbooks aren't accepted. Save it as a plain .xlsx without macros.";

/** Only the parts this reader uses are inflated. */
const wanted = (name: string) =>
  ["[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml"].includes(name) || /^xl\/worksheets\/[^/]+\.xml$/.test(name);

/**
 * Inflates in small steps and counts what really comes out, so a part lying about its size
 * stops at the limit instead of decoding gigabytes while the server waits.
 */
function inflateWanted(bytes: Uint8Array): Record<string, Uint8Array> {
  const parts: Record<string, Uint8Array> = {};
  let produced = 0;
  const reader = new Unzip((file) => {
    if (!wanted(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) throw err;
      size += data.length;
      produced += data.length;
      if (produced > MAX_UNCOMPRESSED_BYTES) throw new UploadError(TOO_BIG, 413);
      if (file.originalSize !== undefined && size > file.originalSize) throw new UploadError(CORRUPT);
      chunks.push(data);
      if (final) {
        const whole = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          whole.set(c, at);
          at += c.length;
        }
        parts[file.name] = whole;
      }
    };
    file.start();
  });
  reader.register(UnzipInflate);
  reader.register(UnzipPassThrough);
  for (let i = 0; i < bytes.length; i += INFLATE_STEP_BYTES) reader.push(bytes.subarray(i, i + INFLATE_STEP_BYTES), i + INFLATE_STEP_BYTES >= bytes.length);
  return parts;
}

function unzip(bytes: Uint8Array) {
  const names = new Set<string>();
  let total = 0;
  try {
    const parts = unzipSync(bytes, {
      // Reads the declared sizes only: nothing inflates here.
      filter: (f) => {
        total += f.originalSize;
        names.add(f.name);
        if (total > MAX_UNCOMPRESSED_BYTES || names.size > MAX_ZIP_ENTRIES) throw new UploadError(TOO_BIG, 413);
        return false;
      },
    });
    void parts;
    return { parts: inflateWanted(bytes), names };
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError(CORRUPT);
  }
}

const decoder = new TextDecoder("utf-8");

/** Reads one XML part. Prefixes such as <x:row> go, since some generators write them. No DTD is ever honoured. */
function xmlPart(parts: Record<string, Uint8Array>, name: string): string | null {
  const data = parts[name];
  if (!data) return null;
  const xml = decoder.decode(data);
  if (/<!doctype/i.test(xml)) throw new UploadError(CORRUPT);
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");
}

function unescapeXml(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[e]) return named[e];
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`(?:^|[\\s:])${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[1] ?? m[2]) : undefined;
};

/** Scans with indexOf, not a regex over the whole part, so a hostile file can't cause quadratic backtracking. */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) return;
    const next = xml[start + open.length];
    if (next !== ">" && next !== "/" && next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
      pos = start + open.length;
      continue;
    }
    const gt = xml.indexOf(">", start);
    if (gt < 0) throw new UploadError(CORRUPT);
    const attrs = xml.slice(start + open.length, gt);
    if (xml[gt - 1] === "/") {
      yield { attrs, body: "" };
      pos = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt);
    if (end < 0) throw new UploadError(CORRUPT);
    yield { attrs, body: xml.slice(gt + 1, end) };
    pos = end + close.length;
  }
}

/** A single huge string, repeated across rows, would otherwise exhaust memory from a tiny file. */
function capped(text: string): string {
  if (text.length > MAX_CELL_CHARS) throw new UploadError(CORRUPT);
  return text;
}

function textOf(body: string): string {
  return capped(body.startsWith("<![CDATA[") && body.endsWith("]]>") ? body.slice(9, -3) : unescapeXml(body));
}

function firstText(body: string, tag: string): string | null {
  for (const el of elements(body, tag)) return textOf(el.body);
  return null;
}

/** Joins rich-text runs. Phonetic guides come last in an <si> and aren't part of the value. */
function joinedText(body: string): string {
  const phonetic = body.indexOf("<rPh");
  let out = "";
  for (const t of elements(phonetic < 0 ? body : body.slice(0, phonetic), "t")) out += textOf(t.body);
  return out;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  if (!xml.trimEnd().endsWith("</sst>") && !xml.trimEnd().endsWith("/>")) throw new UploadError(CORRUPT);
  const out: string[] = [];
  for (const si of elements(xml, "si")) out.push(capped(joinedText(si.body)));
  return out;
}

const BUILT_IN_DATES = (id: number) => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);

/** Excel stores dates as numbers and only the style says so. Literals and [colour] sections aren't date codes. */
const isDateCode = (code: string) => /[ymdhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));

function dateStyles(xml: string | null): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, boolean>();
  for (const f of elements(xml, "numFmt")) custom.set(Number(attr(f.attrs, "numFmtId")), isDateCode(attr(f.attrs, "formatCode") ?? ""));
  const out: boolean[] = [];
  for (const section of elements(xml, "cellXfs")) {
    for (const xf of elements(section.body, "xf")) {
      const id = Number(attr(xf.attrs, "numFmtId") ?? 0);
      out.push(custom.get(id) ?? BUILT_IN_DATES(id));
    }
  }
  return out;
}

/** Wall-clock text with no zone, as a CSV would hold it: the date rules then treat both file types alike. */
function serialToText(serial: number, date1904: boolean): Cell {
  if (!(serial >= 1 && serial < 2958466)) return serial;
  const seconds = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400);
  return new Date(seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function columnIndex(ref: string | undefined): number | null {
  const letters = ref ? /^[A-Z]+/i.exec(ref)?.[0] : undefined;
  if (!letters) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + ch.charCodeAt(0) - 64;
    if (n > MAX_COLUMNS) throw new UploadError(`This sheet has more than ${MAX_COLUMNS} columns.`, 413);
  }
  return n - 1;
}

/** A formula is never read: only the value Excel saved for it, or nothing if it saved none. */
function cellValue(attrs: string, body: string, strings: string[], dates: boolean[], date1904: boolean): Cell {
  const type = attr(attrs, "t") ?? "n";
  if (type === "inlineStr") {
    for (const is of elements(body, "is")) return capped(joinedText(is.body));
    return "";
  }
  const v = firstText(body, "v");
  if (v === null) return "";
  if (type === "s") {
    const s = strings[Number(v)];
    if (s === undefined) throw new UploadError(CORRUPT);
    return s;
  }
  if (type === "b") return v === "1" ? "TRUE" : "FALSE";
  if (type !== "n") return v; // str, e (an error such as #REF!, which no number or date check accepts) and d (ISO text).
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n)) return v;
  return dates[Number(attr(attrs, "s") ?? 0)] ? serialToText(n, date1904) : n;
}

function sheetRows(xml: string, strings: string[], dates: boolean[], date1904: boolean): SheetRow[] {
  if (!xml.trimEnd().endsWith("</worksheet>")) throw new UploadError(CORRUPT);
  const rows: SheetRow[] = [];
  let line = 0;
  for (const data of elements(xml, "sheetData")) {
    for (const row of elements(data.body, "row")) {
      line = Number(attr(row.attrs, "r")) || line + 1;
      const cells: Cell[] = [];
      for (const c of elements(row.body, "c")) {
        const col = columnIndex(attr(c.attrs, "r")) ?? cells.length;
        if (col >= MAX_COLUMNS) throw new UploadError(`This sheet has more than ${MAX_COLUMNS} columns.`, 413);
        while (cells.length < col) cells.push("");
        cells[col] = cellValue(c.attrs, c.body, strings, dates, date1904);
      }
      if (!cells.some((v) => String(v).trim() !== "")) continue;
      rows.push({ line, cells });
      if (rows.length > MAX_SHEET_ROWS) throw new UploadError(`This sheet has too many rows. Import up to ${(MAX_SHEET_ROWS - 100).toLocaleString("en-US")} at a time.`, 413);
    }
  }
  return rows;
}

export interface XlsxContent {
  sheets: string[];
  sheet: string;
  rows: SheetRow[];
}

/** Checks the package first, then reads one sheet: the chosen one, or the first. Cells are data, never evaluated. */
export function readXlsx(bytes: Uint8Array, sheetName?: string): XlsxContent {
  const { parts, names } = unzip(bytes);
  const types = xmlPart(parts, "[Content_Types].xml");
  if (!types || !names.has("xl/workbook.xml")) throw new UploadError(NOT_WORKBOOK);
  if (names.has("xl/vbaProject.bin") || /macroEnabled/i.test(types)) throw new UploadError(MACROS);
  if (!types.includes("spreadsheetml.sheet.main+xml")) throw new UploadError(NOT_WORKBOOK);

  const workbook = xmlPart(parts, "xl/workbook.xml");
  const rels = xmlPart(parts, "xl/_rels/workbook.xml.rels");
  if (!workbook || !rels || !workbook.trimEnd().endsWith("</workbook>")) throw new UploadError(CORRUPT);

  const targets = new Map<string, string>();
  for (const r of elements(rels, "Relationship")) {
    if (!attr(r.attrs, "Type")?.endsWith("/worksheet")) continue;
    const target = (attr(r.attrs, "Target") ?? "").replace(/^\//, "");
    targets.set(attr(r.attrs, "Id") ?? "", target.startsWith("xl/") ? target : `xl/${target}`);
  }
  const sheets: { name: string; path: string }[] = [];
  for (const s of elements(workbook, "sheet")) {
    const path = targets.get(attr(s.attrs, "id") ?? "");
    if (path) sheets.push({ name: attr(s.attrs, "name") ?? `Sheet ${sheets.length + 1}`, path }); // Chart sheets have no worksheet target.
  }
  if (sheets.length === 0) throw new UploadError("This workbook has no worksheets.");
  const chosen = sheetName === undefined ? sheets[0] : sheets.find((s) => s.name === sheetName);
  if (!chosen) throw new UploadError(`This workbook has no sheet called "${sheetName}".`);
  const sheet = xmlPart(parts, chosen.path);
  if (!sheet) throw new UploadError(CORRUPT);

  let date1904 = false;
  for (const p of elements(workbook, "workbookPr")) date1904 = ["1", "true"].includes(attr(p.attrs, "date1904") ?? "");
  const rows = sheetRows(sheet, sharedStrings(xmlPart(parts, "xl/sharedStrings.xml")), dateStyles(xmlPart(parts, "xl/styles.xml")), date1904);
  return { sheets: sheets.map((s) => s.name), sheet: chosen.name, rows };
}
