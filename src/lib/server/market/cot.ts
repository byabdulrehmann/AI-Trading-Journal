import "server-only";
import { RANGE_WEEKS, scoreAsset, scorePair, type AssetPositioning, type CotWeek, type PairPositioning } from "@/lib/domain/positioning";
import { db, transaction } from "../db";
import { macro as readMacro, type Macro } from "./fred";

/** The CFTC's public Legacy futures-only report (Socrata). Free, no key, and nothing about the user is sent. */
const ENDPOINT = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";

export const ASSETS = [
  { key: "USD", code: "098662", name: "US dollar index" },
  { key: "EUR", code: "099741", name: "Euro" },
  { key: "GBP", code: "096742", name: "British pound" },
  { key: "JPY", code: "097741", name: "Japanese yen" },
  { key: "CHF", code: "092741", name: "Swiss franc" },
  { key: "CAD", code: "090741", name: "Canadian dollar" },
  { key: "AUD", code: "232741", name: "Australian dollar" },
  { key: "NZD", code: "112741", name: "New Zealand dollar" },
  { key: "XAU", code: "088691", name: "Gold" },
  { key: "XAG", code: "084691", name: "Silver" },
  { key: "WTI", code: "067651", name: "WTI crude oil" },
  { key: "US500", code: "13874A", name: "S&P 500 (E-mini)" },
  { key: "US100", code: "209742", name: "Nasdaq 100 (E-mini)" },
  { key: "US30", code: "124603", name: "Dow Jones (E-mini)" },
  { key: "BTC", code: "133741", name: "Bitcoin (CME)" },
] as const;

const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "XAUUSD"];
const DAY = 86_400_000;
// Each Friday's report is as of the Tuesday before, so the next one is due 10 days after the newest date.
const STALE_AFTER = 11 * DAY;
const RETRY_AFTER = 3_600_000;

export interface Positioning {
  asOf: string | null;
  assets: AssetPositioning[];
  pairs: PairPositioning[];
  macro: Macro;
  /** Set when the CFTC couldn't be reached; what's shown is the last report saved. */
  notice: string | null;
}

const g = globalThis as unknown as { __jarvisCot?: { lastAttempt: number; running: Promise<void> | null; error: string | null } };
g.__jarvisCot ??= { lastAttempt: 0, running: null, error: null };
const state = g.__jarvisCot;

const newest = () => (db().prepare("SELECT MAX(report_date) AS d FROM cot_reports").get() as { d: string | null }).d;

const count = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** Fetches what's missing, at most once an hour. Never throws: a failure leaves the saved reports in place. */
export async function refreshCot(): Promise<void> {
  const last = newest();
  if (last && Date.now() - Date.parse(last) < STALE_AFTER) return;
  if (state.running) return state.running;
  if (Date.now() - state.lastAttempt < RETRY_AFTER) return;
  state.lastAttempt = Date.now();
  state.running = (async () => {
    try {
      const since = last ?? new Date(Date.now() - (RANGE_WEEKS + 2) * 7 * DAY).toISOString().slice(0, 10);
      const url = new URL(ENDPOINT);
      url.searchParams.set("$select", "cftc_contract_market_code,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all,open_interest_all");
      url.searchParams.set("$where", `report_date_as_yyyy_mm_dd >= '${since}' AND cftc_contract_market_code in(${ASSETS.map((a) => `'${a.code}'`).join(",")})`);
      url.searchParams.set("$limit", "10000");
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`The CFTC answered ${res.status}.`);
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) throw new Error("The CFTC sent something unexpected.");
      const codes = new Set<string>(ASSETS.map((a) => a.code));
      const conn = db();
      const put = conn.prepare(`INSERT INTO cot_reports (code, report_date, long, short, open_interest) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (code, report_date) DO UPDATE SET long = excluded.long, short = excluded.short, open_interest = excluded.open_interest`);
      transaction(conn, () => {
        for (const r of rows as Record<string, unknown>[]) {
          const date = String(r.report_date_as_yyyy_mm_dd ?? "").slice(0, 10);
          const [long, short, oi] = [count(r.noncomm_positions_long_all), count(r.noncomm_positions_short_all), count(r.open_interest_all)];
          if (!codes.has(String(r.cftc_contract_market_code)) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || long === null || short === null || oi === null) continue;
          put.run(String(r.cftc_contract_market_code), date, long, short, oi);
        }
      });
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error && err.name !== "TimeoutError" ? err.message : "The CFTC didn't answer in time.";
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

/** The scorecard from the saved reports. Reads only the database. */
export function positioning(): Positioning {
  const rows = db().prepare("SELECT code, report_date, long, short, open_interest FROM cot_reports ORDER BY report_date").all() as {
    code: string; report_date: string; long: number; short: number; open_interest: number;
  }[];
  const byCode = new Map<string, CotWeek[]>();
  for (const r of rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), { date: r.report_date, long: r.long, short: r.short, openInterest: r.open_interest }]);
  const assets = ASSETS.map((a) => scoreAsset(a.key, a.name, byCode.get(a.code) ?? [])).filter((a): a is AssetPositioning => a !== null);
  const find = (k: string) => assets.find((a) => a.key === k);
  const macro = readMacro();
  const macroOf = (k: string) => macro.currencies.find((c) => c.key === k)?.score ?? null;
  const pairs = PAIRS.flatMap((p) => {
    const base = find(p.slice(0, 3));
    const quote = find(p.slice(3));
    return base && quote ? [scorePair(base, quote, macroOf(base.key), macroOf(quote.key))] : [];
  });
  const asOf = assets.reduce<string | null>((d, a) => (d && d > a.date ? d : a.date), null);
  return {
    asOf,
    assets,
    pairs,
    macro,
    notice: state.error ? `${state.error} ${asOf ? `Showing the report as of ${asOf}.` : "No report is saved yet."}` : null,
  };
}
