import { TradeInput, type TradeData } from "./types";

/** Fields a CSV column can map to. */
export const CSV_FIELDS = {
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
  setup: { label: "Setup", required: false, hints: ["setup", "strategy"] },
  notes: { label: "Notes", required: false, hints: ["notes", "note", "comment"] },
} as const;

export type CsvField = keyof typeof CSV_FIELDS;
export type ColumnMapping = Partial<Record<CsvField, number>>;

/** RFC-4180-style parser: quoted fields, escaped quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
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
  /** Skipped because the account already holds this trade. */
  duplicate?: boolean;
}

/** What makes two rows the same trade. Multiple identical rows in one file are kept: they can be real partial fills. */
export function tradeKey(t: Pick<TradeData, "symbol" | "side" | "openedAt" | "entryPrice" | "quantity">): string {
  return [t.symbol, t.side, new Date(t.openedAt).toISOString(), t.entryPrice, t.quantity].join("|");
}

export interface ImportOptions {
  /** dot: 1,234.56; comma: 1.234,56. Unset: anything that depends on the choice is an error, not a guess. */
  numberFormat?: "dot" | "comma";
  /** dmy: 31/12/2026; mdy: 12/31/2026. Unset: dates that could be either are an error, not a guess. */
  dateOrder?: "dmy" | "mdy";
  /** Symbol → value of 1 unit of size per 1.00 of price, for files without a contract size column. */
  contractSizes?: Record<string, number>;
}

function num(v: string | undefined, format: ImportOptions["numberFormat"]): number | null {
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

function side(v: string | undefined): "long" | "short" | null {
  const s = (v ?? "").trim().toLowerCase();
  if (["buy", "long", "b", "bot", "bought"].includes(s)) return "long";
  if (["sell", "short", "s", "sld", "sold"].includes(s)) return "short";
  return null;
}

function date(v: string | undefined, order: ImportOptions["dateOrder"]): string | null {
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

function dateProblem(label: string, raw: string | undefined, parsed: string | null): string | null {
  if (parsed === "ambiguous") return `${label} "${raw}" could be day-first or month-first. Choose a date format`;
  if (parsed === "invalid") return `${label} "${raw}" isn't a date`;
  return null;
}

export function mapRows(rows: string[][], mapping: ColumnMapping, accountId: number, options: ImportOptions = {}): RowResult[] {
  const missing = (Object.keys(CSV_FIELDS) as CsvField[]).filter(
    (f) => CSV_FIELDS[f].required && mapping[f] === undefined,
  );
  return rows.map((cells, i) => {
    const line = i + 2; // header is line 1
    if (missing.length)
      return { line, ok: false, errors: [`Map a column for: ${missing.map((f) => CSV_FIELDS[f].label).join(", ")}`] };
    const get = (f: CsvField) => (mapping[f] === undefined ? undefined : cells[mapping[f] as number]);
    const errors: string[] = [];
    const s = side(get("side"));
    if (!s) errors.push(`Side "${get("side") ?? ""}" isn't buy/sell or long/short`);
    const openedAt = date(get("openedAt"), options.dateOrder);
    const closedAt = date(get("closedAt"), options.dateOrder);
    const openProblem = openedAt ? dateProblem("Open time", get("openedAt"), openedAt) : `Open time "${get("openedAt") ?? ""}" isn't a date`;
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
      if (Number.isNaN(v)) errors.push(`${CSV_FIELDS[k as CsvField].label} "${get(k as CsvField)}" isn't a clear number. Check the number format`);
    if (errors.length) return { line, ok: false, errors };

    const parsed = TradeInput.safeParse({
      accountId,
      symbol: get("symbol") ?? "",
      side: s,
      openedAt,
      closedAt: closedAt ?? null,
      entryPrice: numbers.entryPrice,
      exitPrice: numbers.exitPrice,
      quantity: numbers.quantity,
      multiplier: numbers.multiplier ?? options.contractSizes?.[(get("symbol") ?? "").trim().toUpperCase()],
      stopPrice: numbers.stopPrice,
      targetPrice: numbers.targetPrice,
      // Brokers sign commission either way, so its sign means nothing; swap's sign says who paid.
      fees: Math.abs(numbers.fees ?? 0) - (numbers.swap ?? 0),
      setup: (get("setup") ?? "").slice(0, 60),
      notes: get("notes") ?? "",
    });
    if (!parsed.success) return { line, ok: false, errors: parsed.error.issues.map((e) => e.message) };
    return { line, ok: true, trade: parsed.data, errors: [] };
  });
}
