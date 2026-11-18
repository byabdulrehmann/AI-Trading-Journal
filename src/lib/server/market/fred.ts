import "server-only";
import { quarterOnQuarter, scoreMacro, type CurrencyMacro, type Observation } from "@/lib/domain/macro";
import { db, transaction } from "../db";
import { decrypt, encrypt } from "../mt5/crypto";

/**
 * Macro readings from FRED (St. Louis Fed). One key serves the whole install, set by the owner and stored
 * encrypted like MT5 passwords. Only the key and the series ids are sent; nothing about anyone's trading.
 */

const API = "https://api.stlouisfed.org/fred/series/observations";
const KEY = "install:fred-key";
const FETCHED = "fred:fetched";

/**
 * The series per economy, checked for freshness on 2026-11-18. FRED has no up-to-date euro area unemployment rate,
 * and the OECD's CPI series it carried stopped in 2025, so inflation isn't scored.
 */
export const MACRO_SERIES: { key: string; rate: string; growth: string; growthIsLevel?: true; unemployment: string | null }[] = [
  { key: "USD", rate: "FEDFUNDS", growth: "NAEXKP01USQ657S", unemployment: "UNRATE" },
  { key: "EUR", rate: "ECBDFR", growth: "CLVMEURSCAB1GQEA19", growthIsLevel: true, unemployment: null },
  { key: "GBP", rate: "IRSTCI01GBM156N", growth: "NAEXKP01GBQ657S", unemployment: "LRHUTTTTGBM156S" },
  { key: "JPY", rate: "IRSTCI01JPM156N", growth: "NAEXKP01JPQ657S", unemployment: "LRHUTTTTJPM156S" },
  { key: "CHF", rate: "IRSTCI01CHM156N", growth: "NAEXKP01CHQ657S", unemployment: "LRUNTTTTCHQ156S" },
  { key: "CAD", rate: "IRSTCI01CAM156N", growth: "NAEXKP01CAQ657S", unemployment: "LRHUTTTTCAM156S" },
  { key: "AUD", rate: "IRSTCI01AUM156N", growth: "NAEXKP01AUQ657S", unemployment: "LRUNTTTTAUM156S" },
  { key: "NZD", rate: "IR3TIB01NZM156N", growth: "NAEXKP01NZQ657S", unemployment: "LRUNTTTTNZQ156S" },
];
// The ECB's rate is daily: FRED averages it to months so it compares with the others.
const MONTHLY = new Set(["ECBDFR"]);
const ALL = [...new Set(MACRO_SERIES.flatMap((s) => [s.rate, s.growth, s.unemployment].filter((x): x is string => !!x)))];

const DAY = 86_400_000;
const REFRESH_AFTER = DAY;
const RETRY_AFTER = 3_600_000;

const setting = (k: string) => (db().prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value ?? null;
const putSetting = (k: string, v: string) => db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export const hasFredKey = () => !!setting(KEY);
function fredKey(): string | null {
  const stored = setting(KEY);
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    return null; // The master key changed: the owner enters it again.
  }
}
export function saveFredKey(key: string | null) {
  if (key) putSetting(KEY, encrypt(key));
  else db().prepare("DELETE FROM settings WHERE key IN (?, ?)").run(KEY, FETCHED);
}

export const FRED_KEY_SHAPE = /^[a-f0-9]{32}$/;

class FredError extends Error {
  constructor(message: string, readonly badKey = false) {
    super(message);
  }
}

async function observations(seriesId: string, key: string, since: string): Promise<Observation[]> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ series_id: seriesId, api_key: key, file_type: "json", observation_start: since, ...(MONTHLY.has(seriesId) ? { frequency: "m" } : {}) })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 400 || res.status === 403) {
    const message = String(((await res.json().catch(() => ({}))) as { error_message?: unknown }).error_message ?? "");
    if (/api_key/i.test(message)) throw new FredError("FRED didn't accept the key.", true);
  }
  if (!res.ok) throw new FredError(`FRED answered ${res.status} for ${seriesId}.`);
  const data = (await res.json()) as { observations?: unknown };
  if (!Array.isArray(data.observations)) throw new FredError("FRED sent something unexpected.");
  return (data.observations as { date?: unknown; value?: unknown }[]).flatMap((o) => {
    const date = String(o.date ?? "");
    const value = Number(o.value); // FRED writes "." for a missing reading
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && o.value !== "." && Number.isFinite(value) ? [{ date, value }] : [];
  });
}

/** Checks a key before it's saved, with one small request. */
export async function checkFredKey(key: string): Promise<"ok" | "rejected" | "unreachable"> {
  try {
    await observations("FEDFUNDS", key, new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10));
    return "ok";
  } catch (err) {
    return err instanceof FredError && err.badKey ? "rejected" : "unreachable";
  }
}

const g = globalThis as unknown as { __jarvisFred?: { lastAttempt: number; running: Promise<void> | null; error: string | null } };
g.__jarvisFred ??= { lastAttempt: 0, running: null, error: null };
const state = g.__jarvisFred;

/** Fetches the last two years of every series, at most daily. Never throws: a failure keeps the saved readings. */
export async function refreshFred(): Promise<void> {
  const key = fredKey();
  if (!key) return;
  const fetched = Number(setting(FETCHED) ?? 0);
  if (Date.now() - fetched < REFRESH_AFTER) return;
  if (state.running) return state.running;
  if (Date.now() - state.lastAttempt < RETRY_AFTER) return;
  state.lastAttempt = Date.now();
  state.running = (async () => {
    try {
      const since = new Date(Date.now() - 2 * 365 * DAY).toISOString().slice(0, 10);
      const results: [string, Observation[]][] = [];
      for (const id of ALL) results.push([id, await observations(id, key, since)]); // one at a time: FRED allows 120 a minute
      const conn = db();
      const put = conn.prepare("INSERT INTO fred_observations (series_id, date, value) VALUES (?, ?, ?) ON CONFLICT (series_id, date) DO UPDATE SET value = excluded.value");
      transaction(conn, () => {
        for (const [id, obs] of results) for (const o of obs) put.run(id, o.date, o.value);
        putSetting(FETCHED, String(Date.now()));
      });
      state.error = null;
    } catch (err) {
      state.error = err instanceof FredError ? err.message : err instanceof Error && err.name === "TimeoutError" ? "FRED didn't answer in time." : "Couldn't reach FRED.";
    } finally {
      state.running = null;
    }
  })();
  return state.running;
}

export interface Macro {
  configured: boolean;
  currencies: CurrencyMacro[];
  notice: string | null;
}

/** The macro scores from the saved readings. Reads only the database. */
export function macro(): Macro {
  const rows = db().prepare("SELECT series_id, date, value FROM fred_observations ORDER BY date").all() as { series_id: string; date: string; value: number }[];
  const bySeries = new Map<string, Observation[]>();
  for (const r of rows) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), { date: r.date, value: r.value }]);
  const get = (id: string | null) => (id ? (bySeries.get(id) ?? []) : []);
  const currencies = rows.length
    ? scoreMacro(MACRO_SERIES.map((s) => ({ key: s.key, rate: get(s.rate), growth: s.growthIsLevel ? quarterOnQuarter(get(s.growth)) : get(s.growth), unemployment: get(s.unemployment) })))
    : [];
  return { configured: hasFredKey(), currencies, notice: state.error && hasFredKey() ? `${state.error} ${rows.length ? "Showing the readings saved before." : ""}`.trim() : null };
}
