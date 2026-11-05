import { CSV_FIELDS, cellText, guessMapping, type Cell, type ColumnMapping, type CsvField, type SheetRow } from "../csv";

/** How one kind of export names its columns. Plain data: a new broker format is a new entry here. */
export interface Adapter {
  id: string;
  label: string;
  /** Normalised header names, tried in order. "time#2" is the second Time column; "net*" matches by prefix. */
  columns: Partial<Record<CsvField, string[]>>;
  /** All of these must resolve for a header row to count as this format. */
  detect: CsvField[];
  /** A row holding only one of these titles ends the table: reports stack other sections below it. */
  sectionEnds?: string[];
}

export const ADAPTERS: Adapter[] = [
  {
    // Written from the column list in the brief. Not checked against a file from a real terminal.
    id: "mt5-history",
    label: "MetaTrader 5 History (Positions)",
    columns: {
      openedAt: ["time#1"],
      sourceId: ["position"],
      symbol: ["symbol"],
      side: ["type"],
      quantity: ["volume"],
      entryPrice: ["price#1"],
      stopPrice: ["s/l"],
      targetPrice: ["t/p"],
      closedAt: ["time#2"],
      exitPrice: ["price#2"],
      fees: ["commission"],
      swap: ["swap"],
      profit: ["profit"],
    },
    detect: ["openedAt", "closedAt", "symbol", "side", "quantity", "entryPrice", "exitPrice"],
    sectionEnds: ["orders", "deals", "open positions", "working orders", "results", "summary"],
  },
  {
    // Column names come from third-party import guides, not cTrader's docs or a real file. Time headers may carry a UTC offset and money headers a currency.
    id: "ctrader",
    label: "cTrader History",
    columns: {
      sourceId: ["position id", "order id", "id"],
      symbol: ["symbol"],
      side: ["direction"],
      openedAt: ["opening time*", "open time*"],
      closedAt: ["closing time*", "close time*"],
      entryPrice: ["entry price*", "open price*"],
      exitPrice: ["closing price*", "close price*"],
      quantity: ["closing quantity*", "closing volume*", "quantity*", "volume*"],
      fees: ["commissions*", "commission*"],
      swap: ["swap*"],
      profit: ["net*", "gross*"],
    },
    detect: ["symbol", "side", "openedAt", "closedAt", "entryPrice", "exitPrice", "quantity"],
  },
  { id: "generic", label: "Generic (match columns by hand)", columns: {}, detect: [] },
];

const normalise = (h: Cell) => cellText(h).trim().toLowerCase().replace(/\s+/g, " ").replace(/ ?\/ ?/g, "/");

function resolve(headers: string[], pattern: string): number | undefined {
  const [name, nth] = pattern.split("#");
  const matches = (h: string) => (name.endsWith("*") ? h.startsWith(name.slice(0, -1)) : h === name);
  return headers.flatMap((h, i) => (matches(h) ? [i] : []))[Number(nth ?? 1) - 1];
}

/** Maps by column index, because names repeat: an MT5 report has two Time and two Price columns. */
export function adapterMapping(adapter: Adapter, headers: Cell[]): ColumnMapping | null {
  if (adapter.id === "generic") return guessMapping(headers.map(cellText));
  const norm = headers.map(normalise);
  const mapping: ColumnMapping = {};
  for (const [field, patterns] of Object.entries(adapter.columns) as [CsvField, string[]][]) {
    for (const p of patterns) {
      const index = resolve(norm, p);
      if (index !== undefined) {
        mapping[field] = index;
        break;
      }
    }
  }
  return adapter.detect.every((f) => mapping[f] !== undefined) ? mapping : null;
}

export interface DetectedTable {
  adapter: string;
  /** False when the chosen adapter's columns weren't found, so the user has to map them. */
  matched: boolean;
  headerLine: number;
  headers: string[];
  mapping: ColumnMapping;
  rows: SheetRow[];
  /** Rows after the end of the table, such as a report's Orders and Deals sections. Reported, not read. */
  trailingRows: number;
}

const HEADER_SCAN_ROWS = 50;
const REQUIRED = (Object.keys(CSV_FIELDS) as CsvField[]).filter((f) => CSV_FIELDS[f].required);

/** Finds the header row, which reports put below a title block, and the rows belonging to it. */
export function detectTable(rows: SheetRow[], adapterId?: string): DetectedTable {
  const candidates = adapterId ? ADAPTERS.filter((a) => a.id === adapterId) : ADAPTERS;
  const scan = rows.slice(0, HEADER_SCAN_ROWS);
  for (const adapter of candidates) {
    for (let i = 0; i < scan.length; i++) {
      const mapping = adapterMapping(adapter, scan[i].cells);
      if (!mapping || (adapter.id === "generic" && !REQUIRED.every((f) => mapping[f] !== undefined))) continue;
      return table(adapter, rows, i, mapping, true);
    }
  }
  const fallback = adapterId ? (ADAPTERS.find((a) => a.id === adapterId) ?? ADAPTERS[ADAPTERS.length - 1]) : ADAPTERS[ADAPTERS.length - 1];
  return table(fallback, rows, 0, rows[0] ? guessMapping(rows[0].cells.map(cellText)) : {}, false);
}

function table(adapter: Adapter, rows: SheetRow[], headerIndex: number, mapping: ColumnMapping, matched: boolean): DetectedTable {
  const body = rows.slice(headerIndex + 1);
  const end = adapter.sectionEnds
    ? body.findIndex((r) => {
        const filled = r.cells.filter((c) => cellText(c).trim() !== "");
        return filled.length === 1 && adapter.sectionEnds!.includes(normalise(filled[0]));
      })
    : -1;
  return {
    adapter: adapter.id,
    matched,
    headerLine: rows[headerIndex]?.line ?? 1,
    headers: (rows[headerIndex]?.cells ?? []).map(cellText),
    mapping,
    rows: end < 0 ? body : body.slice(0, end),
    trailingRows: end < 0 ? 0 : body.length - end,
  };
}
