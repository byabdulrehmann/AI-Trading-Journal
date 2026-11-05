import { computePnl } from "./trade-math";
import { TradeInput, type TradeData } from "./types";

/** "10 MB" in decimal: a full-size upload plus its multipart overhead stays under the proxy's 10 MiB body buffer. */
export const MAX_UPLOAD_BYTES = 10_000_000;
export const MAX_DATA_ROWS = 20_000;
/** Reports also hold title blocks and other sections, which don't count as trades but do cost memory. */
export const MAX_SHEET_ROWS = MAX_DATA_ROWS + 100;

/** Fields a CSV column can map to. */
export const CSV_FIELDS = {
  sourceId: { label: "Ticket / position ID", required: false, hints: ["ticket", "position id", "position", "deal id", "order id", "trade id"] },
  symbol: { label: "Symbol", required: true, hints: ["symbol", "instrument", "ticker", "market", "pair"] },
  side: { label: "Side (buy/sell, long/short)", required: true, hints: ["side", "direction", "type", "action"] },
  openedAt: { label: "Open time", required: true, hints: ["open time", "opened", "entry time", "open date", "date", "time"] },
  closedAt: { label: "Close time", required: false, hints: ["close time", "closed", "exit time", "close date"] },
  entryPrice: { label: "Entry price", required: true, hints: ["entry", "open price", "entry price", "price in"] },
  exitPrice: { label: "Exit price", required: false, hints: ["exit", "close price", "exit price", "price out"] },
  quantity: { label: "Size / quantity", required: true, hints: ["quantity", "qty", "size", "volume", "lots", "contracts", "shares"] },
  multiplier: { label: "Contract size", required: false, hints: ["multiplier", "contract size", "lot size", "point value"] },
  stopPrice: { label: "Stop price", required: false, hints: ["stop", "sl", "stop loss"] },
  targetPrice: { label: "Target price", required: false, hints: ["target", "tp", "take profit"] },
  fees: { label: "Fees / commission", required: false, hints: ["fee", "fees", "commission"] },
  swap: { label: "Swap (a credit is positive)", required: false, hints: ["swap", "rollover", "financing"] },
  profit: { label: "Broker profit (only used as a check)", required: false, hints: ["profit", "p/l", "pnl", "p&l"] },
  setup: { label: "Setup", required: false, hints: ["setup", "strategy"] },
  notes: { label: "Notes", required: false, hints: ["notes", "note", "comment"] },
} as const;

export type CsvField = keyof typeof CSV_FIELDS;
export type ColumnMapping = Partial<Record<CsvField, number>>;

/** A spreadsheet number stays a number: it has no decimal-separator question to ask. */
export type Cell = string | number;
export interface SheetRow {
  /** Line in the file, or row in the sheet, counting blanks: what the user sees when they open it. */
  line: number;
  cells: Cell[];
}

export const cellText = (c: Cell | undefined) => (c === undefined ? "" : String(c));

/** Semicolon files are normal where the comma is the decimal mark. The first line with any separator decides. */
function detectDelimiter(src: string): string {
  for (const raw of src.split(/\r\n?|\n/, 50)) {
    const line = raw.replace(/"[^"]*"/g, "");
    const counts = [",", ";", "\t"].map((d) => [d, line.split(d).length - 1] as const).sort((a, b) => b[1] - a[1]);
    if (counts[0][1] > 0) return counts[0][0];
  }
  return ",";
}

/** RFC-4180-style parser: quoted fields, escaped quotes, CRLF or LF. Blank lines are skipped, keeping true line numbers. */
export function parseCsvRows(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  const src = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(src);
  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push({ line: rowLine, cells: row });
    row = [];
    field = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
      quoteLine = line;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
      rowLine = ++line;
    } else field += c;
  }
  // Otherwise every row after the stray quote would vanish into one cell.
  if (quoted) throw new Error(`Line ${quoteLine} opens a quote that never closes.`);
  endRow();
  return rows;
}

export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells);
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_-]+/g, " "));
  for (const [field, def] of Object.entries(CSV_FIELDS) as [CsvField, (typeof CSV_FIELDS)[CsvField]][]) {
    // Exact hint match first, then "contains".
    let idx = norm.findIndex((h, i) => !used.has(i) && (def.hints as readonly string[]).includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !used.has(i) && def.hints.some((hint) => h.includes(hint)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

export interface RowResult {
  line: number;
  ok: boolean;
  trade?: TradeData;
  errors: string[];
  /** Imported anyway, but worth a look. */
  warnings?: string[];
  /** The file's profit differs from the calculated P&L. */
  mismatch?: boolean;
  sourceKey?: string;
}

export interface InvalidRow {
  line: number;
  errors: string[];
  raw: string;
}

/** POST /api/imports without commit. total = valid + invalid + duplicates. */
export interface ImportPreview {
  fileName: string;
  sha256: string;
  format: "csv" | "xlsx";
  sheets: string[];
  sheet: string | null;
  adapter: string;
  adapterMatched: boolean;
  headerLine: number;
  headers: string[];
  mapping: ColumnMapping;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  duplicateLines: number[];
  trailingRows: number;
  netPnl: number;
  mismatches: number;
  symbols: { symbol: string; contractSize: number | null }[];
  unknownSides: string[];
  feesMapped: boolean;
  preview: RowResult[];
  flagged: RowResult[];
  errors: InvalidRow[];
}

export interface ImportResult {
  batch: string;
  imported: number;
  duplicates: number;
  invalid: number;
  total: number;
  mismatches: number;
  errors: InvalidRow[];
}

/** The fields that identify a row. Identical rows in one file can be real partial fills, so callers add an occurrence number. */
export function tradeKey(t: Pick<TradeData, "symbol" | "side" | "openedAt" | "entryPrice" | "exitPrice" | "quantity">): string {
  return [t.symbol, t.side, new Date(t.openedAt).toISOString(), t.entryPrice, t.exitPrice ?? "", t.quantity].join("|");
}

/** A spreadsheet would run a cell starting with one of these as a formula, so the download defuses it. */
const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function invalidRowsCsv(rows: InvalidRow[]): string {
  return [["line", "reason", "row"], ...rows.map((r) => [r.line, r.errors.join("; "), r.raw])].map((cols) => cols.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Null when they agree within 1%, or when there's nothing to compare. Brokers' profit columns may be before or
 * after costs (MT5 before, cTrader's Net after), so agreeing with either counts. One cent of leeway covers rounding.
 */
export function profitMismatch(t: TradeData, broker: number): string | null {
  const net = computePnl(t);
  if (net === null) return null;
  const gross = computePnl({ ...t, commission: 0, swap: 0, otherFees: 0 }) as number;
  const off = Math.min(Math.abs(net - broker), Math.abs(gross - broker));
  if (off <= Math.max(Math.abs(broker) * 0.01, 0.01)) return null;
  return `File says profit ${broker}, calculated ${Math.round(net * 100) / 100}. Check the contract size`;
}

export interface ImportOptions {
  /** dot: 1,234.56; comma: 1.234,56. Unset: anything that depends on the choice is an error, not a guess. */
  numberFormat?: "dot" | "comma";
  /** dmy: 31/12/2026; mdy: 12/31/2026. Unset: dates that could be either are an error, not a guess. */
  dateOrder?: "dmy" | "mdy";
  /** Symbol → value of 1 unit of size per 1.00 of price, for files without a contract size column. */
  contractSizes?: Record<string, number>;
  /** Symbol in the file → symbol to store, such as EURUSD.M → EURUSD. */
  symbolMap?: Record<string, string>;
  /** Lower-cased word in the file → direction, for words not recognised by default. */
  sideMap?: Record<string, "long" | "short">;
}

const clip = (v: Cell | undefined) => cellText(v).slice(0, 60);

function num(v: Cell | undefined, format: ImportOptions["numberFormat"]): number | null {
  if (typeof v === "number") return v;
  if (v === undefined || v.trim() === "") return null;
  const s = v.replace(/[$\s]/g, "");
  let plain: string;
  if (format === "comma") {
    if (!/^-?(\d+|\d{1,3}(\.\d{3})+)(,\d+)?$/.test(s)) return NaN;
    plain = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Without a choice, a comma counts as thousands only when a dot proves it: "1,085" could be 1085 or 1.085.
    const thousands = format === "dot" ? /^-?\d{1,3}(,\d{3})+(\.\d+)?$/ : /^-?\d{1,3}(,\d{3})+\.\d+$/;
    if (s.includes(",") && !thousands.test(s)) return NaN;
    plain = s.replace(/,/g, "");
  }
  const n = Number(plain);
  return Number.isFinite(n) ? n : NaN;
}

export function side(v: Cell | undefined, map?: ImportOptions["sideMap"]): "long" | "short" | null {
  const s = cellText(v).trim().toLowerCase();
  if (map?.[s]) return map[s];
  if (["buy", "long", "b", "bot", "bought"].includes(s)) return "long";
  if (["sell", "short", "s", "sld", "sold"].includes(s)) return "short";
  return null;
}

function date(v: Cell | undefined, order: ImportOptions["dateOrder"]): string | null {
  // A plain number isn't a date: Date.parse would read "12" as 2001 and "46000" as a far-off year.
  if (typeof v === "number" || (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v))) return "invalid";
  if (!v || !v.trim()) return null;
  // Accept "2026.10.03 14:05" (MT5 export style) as well as ISO-ish strings.
  let cleaned = v.trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3");
  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?=\s|T|$)(.*)$/.exec(cleaned);
  if (parts) {
    const [a, b] = [Number(parts[1]), Number(parts[2])];
    const resolved = order ?? (a > 12 || a === b ? "dmy" : b > 12 ? "mdy" : null);
    if (!resolved) return "ambiguous";
    const [day, month] = resolved === "dmy" ? [a, b] : [b, a];
    const year = parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]);
    if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return "invalid";
    // A time keeps Date.parse in local time; a bare date would be read as UTC.
    cleaned = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}${parts[4] || " 00:00"}`;
  }
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? "invalid" : new Date(t).toISOString();
}

function dateProblem(label: string, raw: Cell | undefined, parsed: string | null): string | null {
  if (parsed === "ambiguous") return `${label} "${clip(raw)}" could be day-first or month-first. Choose a date format`;
  if (parsed === "invalid") return `${label} "${clip(raw)}" isn't a date`;
  return null;
}

/** `lines` gives each row's line in the file. Without it, rows are taken to follow a header on line 1. */
export function mapRows(rows: Cell[][], mapping: ColumnMapping, accountId: number, options: ImportOptions = {}, lines?: number[]): RowResult[] {
  const missing = (Object.keys(CSV_FIELDS) as CsvField[]).filter(
    (f) => CSV_FIELDS[f].required && mapping[f] === undefined,
  );
  return rows.map((cells, i) => {
    const line = lines?.[i] ?? i + 2;
    if (missing.length)
      return { line, ok: false, errors: [`Map a column for: ${missing.map((f) => CSV_FIELDS[f].label).join(", ")}`] };
    const get = (f: CsvField) => (mapping[f] === undefined ? undefined : cells[mapping[f] as number]);
    const text = (f: CsvField) => cellText(get(f));
    const rawSymbol = text("symbol").trim().toUpperCase();
    if (!rawSymbol && !text("side").trim() && !text("openedAt").trim())
      return { line, ok: false, errors: ["Not a trade: no symbol, side or open time. This is often a totals line"] };

    const errors: string[] = [];
    const symbol = options.symbolMap?.[rawSymbol]?.toUpperCase() ?? rawSymbol;
    // Text fields stay as text everywhere; a symbol has no reason to look like a formula, so it isn't taken for one.
    if (/^[=+\-@]/.test(symbol)) errors.push(`Symbol "${clip(symbol)}" isn't a symbol`);
    const s = side(get("side"), options.sideMap);
    if (!s) errors.push(`Side "${clip(get("side"))}" isn't buy/sell or long/short. Map it to a direction`);
    const openedAt = date(get("openedAt"), options.dateOrder);
    const closedAt = date(get("closedAt"), options.dateOrder);
    const openProblem = openedAt ? dateProblem("Open time", get("openedAt"), openedAt) : "Open time is missing";
    const closeProblem = dateProblem("Close time", get("closedAt"), closedAt);
    if (openProblem) errors.push(openProblem);
    if (closeProblem) errors.push(closeProblem);
    const value = (f: CsvField) => num(get(f), options.numberFormat);
    const numbers = {
      entryPrice: value("entryPrice"),
      exitPrice: value("exitPrice"),
      quantity: value("quantity"),
      multiplier: value("multiplier"),
      stopPrice: value("stopPrice"),
      targetPrice: value("targetPrice"),
      fees: value("fees"),
      swap: value("swap"),
    };
    for (const [k, v] of Object.entries(numbers))
      if (Number.isNaN(v)) errors.push(`${CSV_FIELDS[k as CsvField].label} "${clip(get(k as CsvField))}" isn't a clear number. Check the number format`);
    if (numbers.entryPrice === null) errors.push("Entry price is missing");
    if (numbers.quantity === null) errors.push("Size is missing");
    if (errors.length) return { line, ok: false, errors };

    // The conventions doc: 0 means no stop, and a stop on the wrong side isn't valid initial risk (MT5 may report a trailed one).
    const warnings: string[] = [];
    const level = (v: number | null, label: string, wrongSide: (v: number) => boolean) => {
      if (!v) return null;
      if (!wrongSide(v)) return v;
      warnings.push(`${label} ${v} is on the wrong side of entry, so it was left out`);
      return null;
    };
    const entry = numbers.entryPrice as number;
    const stopPrice = level(numbers.stopPrice, "Stop", (v) => (s === "long" ? v >= entry : v <= entry));
    const targetPrice = level(numbers.targetPrice, "Target", (v) => (s === "long" ? v <= entry : v >= entry));

    const parsed = TradeInput.safeParse({
      accountId,
      symbol,
      side: s,
      openedAt,
      closedAt: closedAt ?? null,
      entryPrice: numbers.entryPrice,
      exitPrice: numbers.exitPrice,
      quantity: numbers.quantity,
      multiplier: numbers.multiplier ?? options.contractSizes?.[rawSymbol] ?? options.contractSizes?.[symbol],
      stopPrice,
      targetPrice,
      // Brokers sign commission either way, so its sign means nothing; swap's sign says who paid.
      commission: Math.abs(numbers.fees ?? 0),
      swap: -(numbers.swap ?? 0),
      setup: text("setup").slice(0, 60),
      notes: text("notes"),
    });
    if (!parsed.success) return { line, ok: false, errors: parsed.error.issues.map((e) => e.message) };

    const broker = value("profit");
    if (Number.isNaN(broker)) warnings.push(`Broker profit "${clip(get("profit"))}" isn't a clear number, so it wasn't compared`);
    const mismatch = broker === null || Number.isNaN(broker) ? null : profitMismatch(parsed.data, broker);
    if (mismatch) warnings.push(mismatch);
    return { line, ok: true, trade: parsed.data, errors: [], ...(warnings.length ? { warnings } : {}), ...(mismatch ? { mismatch: true } : {}) };
  });
}
