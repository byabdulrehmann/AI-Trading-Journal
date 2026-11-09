import { z } from "zod";
import { parseCsvRows } from "./csv";
import { zoneInstant } from "./zone";

/** Economic calendar events: entered by hand or imported from a CSV the user downloaded. Jarvis fetches none. */
export const IMPACTS = ["high", "medium", "low", "holiday"] as const;
export type Impact = (typeof IMPACTS)[number];
export const IMPACT_LABELS: Record<Impact, string> = { high: "High", medium: "Medium", low: "Low", holiday: "Holiday" };

export const EventInput = z.object({
  /** UTC instant. For an all-day event, the start of that day in the zone it was entered in. */
  at: z.iso.datetime({ message: "Enter the date and time" }),
  allDay: z.boolean().default(false),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter code, like USD"),
  title: z.string().trim().min(1, "Name the event").max(120),
  impact: z.enum(IMPACTS),
  actual: z.string().trim().max(30).default(""),
  forecast: z.string().trim().max(30).default(""),
  previous: z.string().trim().max(30).default(""),
});
export type EventData = z.output<typeof EventInput>;

const CODES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNY"];

/** An event counts for a symbol that names its currency. A symbol naming none (a stock, an index) counts every currency. */
export function eventApplies(symbol: string, currency: string): boolean {
  const s = symbol.toUpperCase();
  const named = CODES.filter((c) => s.includes(c));
  return named.length === 0 || named.includes(currency.toUpperCase());
}

/** Minutes from the instant to the nearest timed high-impact event for the symbol, or null with none. */
export function minutesToNews(symbol: string, atMs: number, events: { at: string; allDay: boolean; impact: string; currency: string }[]): number | null {
  let best: number | null = null;
  for (const e of events) {
    if (e.allDay || e.impact !== "high" || !eventApplies(symbol, e.currency)) continue;
    const d = Math.abs(Date.parse(e.at) - atMs) / 60_000;
    if (best === null || d < best) best = d;
  }
  return best;
}

const HEADERS: Record<keyof Omit<EventData, "allDay" | "at"> | "date" | "time", RegExp> = {
  date: /^(date|day|datetime|date\/time|time \(utc\)|timestamp)$/,
  time: /^(time|hour)$/,
  currency: /^(currency|country|cur|ccy)$/,
  title: /^(event|title|name|description|indicator)$/,
  impact: /^(impact|importance|volatility)$/,
  actual: /^actual$/,
  forecast: /^(forecast|consensus|expected)$/,
  previous: /^(previous|prior|prev)$/,
};

function impactOf(v: string): Impact | null {
  const s = v.trim().toLowerCase();
  if (/high|red|^3$/.test(s)) return "high";
  if (/medium|moderate|orange|^2$/.test(s)) return "medium";
  if (/low|yellow|non-economic|^1$/.test(s)) return "low";
  if (/holiday/.test(s)) return "holiday";
  return null;
}

/** "2026-11-06", "2026.11.06", "11-06-2026", "06/11/2026" (dayFirst). */
function dateOf(v: string, dayFirst: boolean): [number, number, number] | null {
  let ymd: [number, number, number];
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(v);
  if (m) ymd = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(v);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2])];
    ymd = dayFirst ? [Number(m[3]), b, a] : [Number(m[3]), a, b];
  }
  // "02-31" or a 13th month would roll over into another date: refuse it.
  const d = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2]));
  return d.getUTCMonth() === ymd[1] - 1 && d.getUTCDate() === ymd[2] ? ymd : null;
}

/** "13:30", "8:30am", "8:30 PM". Empty, "All Day", "Tentative" and the like: no time. */
function timeOf(v: string): [number, number] | "none" | null {
  const s = v.trim().toLowerCase();
  if (s === "" || /all ?day|tentative|day \d|^-+$/.test(s)) return "none";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : [h, min];
}

export interface EventsCsvResult {
  events: EventData[];
  errors: { line: number; message: string }[];
  /** The header row was missing a column the import needs. */
  missing: string[];
}

/** Reads a calendar CSV. Times are read in `zone`, the zone the file was exported in. */
export function parseEventsCsv(text: string, opts: { zone?: string; dayFirst?: boolean } = {}): EventsCsvResult {
  const rows = parseCsvRows(text);
  const header = rows[0]?.cells.map((c) => c.trim().toLowerCase()) ?? [];
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, re]) => [k, header.findIndex((h) => re.test(h))])) as Record<keyof typeof HEADERS, number>;
  const missing = (["date", "currency", "title", "impact"] as const).filter((k) => col[k] < 0);
  if (missing.length) return { events: [], errors: [], missing };

  const events: EventData[] = [];
  const errors: EventsCsvResult["errors"] = [];
  for (const { line, cells } of rows.slice(1)) {
    const cell = (k: keyof typeof HEADERS) => (col[k] >= 0 ? (cells[col[k]] ?? "").trim() : "");
    if (cells.every((c) => c.trim() === "")) continue;
    // A date cell may carry its own time: "2026-11-06 13:30" or "2026-11-06T13:30".
    const [datePart, ...rest] = cell("date").split(/[ T]+/);
    const date = dateOf(datePart ?? "", opts.dayFirst ?? false);
    const timeText = col.time >= 0 && cell("time") ? cell("time") : rest.join(" ");
    const time = timeOf(timeText);
    const impact = impactOf(cell("impact"));
    const problem = !date ? `Couldn't read the date "${cell("date")}".` : time === null ? `Couldn't read the time "${timeText}".` : !impact ? `Couldn't read the impact "${cell("impact")}".` : null;
    if (problem) {
      errors.push({ line, message: problem });
      continue;
    }
    const [y, mo, d] = date!;
    const [h, mi] = time === "none" ? [0, 0] : (time as [number, number]);
    const at = zoneInstant(y, mo, d, h, mi, opts.zone);
    const parsed = EventInput.safeParse({ at: new Date(at).toISOString(), allDay: time === "none", currency: cell("currency"), title: cell("title"), impact, actual: cell("actual"), forecast: cell("forecast"), previous: cell("previous") });
    if (parsed.success) events.push(parsed.data);
    else errors.push({ line, message: parsed.error.issues[0].message });
  }
  return { events, errors, missing };
}
