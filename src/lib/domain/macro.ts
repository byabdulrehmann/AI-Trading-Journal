/**
 * Jarvis's macro score per currency, from FRED data: the interest rate, its 6-month trend, real growth and the
 * 6-month change in unemployment. Each factor compares the economies with each other, so a score says which
 * currency's backdrop is stronger, not whether an economy is doing well in absolute terms.
 */

export interface Observation {
  date: string; // YYYY-MM-DD
  value: number;
}

export type MacroFactorId = "rate" | "rateTrend" | "growth" | "jobs";

export interface MacroFactor {
  id: MacroFactorId;
  /** The reading itself: %, percentage points, or % q/q. Null when missing or out of date. */
  value: number | null;
  /** −1…+1 against the other economies. Null when there's nothing to compare. */
  score: number | null;
  date: string | null;
}

export interface CurrencyMacro {
  key: string;
  score: number | null;
  factors: MacroFactor[];
}

export interface MacroInput {
  key: string;
  rate: Observation[];
  growth: Observation[];
  unemployment: Observation[];
}

export const FACTOR_LABELS: Record<MacroFactorId, string> = {
  rate: "Interest rate",
  rateTrend: "Rate, 6-month change",
  growth: "GDP growth, q/q",
  jobs: "Unemployment, 6-month change",
};

const DAY = 86_400_000;
/** Older than this, a reading is left out rather than compared with fresh ones. */
export const FRESH_DAYS = 270;
const MIN_ECONOMIES = 3;

const age = (date: string, today: number) => (today - Date.parse(date)) / DAY;

/** The latest fresh reading, or null. Observations oldest first. */
function latest(obs: Observation[], today: number): Observation | null {
  const last = obs.at(-1);
  return last && age(last.date, today) <= FRESH_DAYS ? last : null;
}

/** Latest minus the reading about six months before it. */
function sixMonthChange(obs: Observation[], today: number): { value: number; date: string } | null {
  const last = latest(obs, today);
  if (!last) return null;
  const before = obs.findLast((o) => Date.parse(last.date) - Date.parse(o.date) >= 170 * DAY);
  return before ? { value: Math.round((last.value - before.value) * 100) / 100, date: last.date } : null;
}

/** z-scores across economies, halved and capped to −1…+1. Null for all when too few economies have a reading. */
function relative(values: (number | null)[]): (number | null)[] {
  const have = values.filter((v): v is number => v !== null);
  if (have.length < MIN_ECONOMIES) return values.map(() => null);
  const mean = have.reduce((a, b) => a + b, 0) / have.length;
  const sd = Math.sqrt(have.reduce((a, b) => a + (b - mean) ** 2, 0) / have.length);
  return values.map((v) => (v === null ? null : sd === 0 ? 0 : Math.round(Math.max(-1, Math.min(1, (v - mean) / sd / 2)) * 100) / 100));
}

export function scoreMacro(inputs: MacroInput[], today = Date.now()): CurrencyMacro[] {
  const raw = inputs.map((i) => {
    const rate = latest(i.rate, today);
    const trend = sixMonthChange(i.rate, today);
    const growth = latest(i.growth, today);
    const jobs = sixMonthChange(i.unemployment, today);
    return {
      rate: { value: rate?.value ?? null, date: rate?.date ?? null },
      rateTrend: { value: trend?.value ?? null, date: trend?.date ?? null },
      growth: { value: growth?.value ?? null, date: growth?.date ?? null },
      jobs: { value: jobs?.value ?? null, date: jobs?.date ?? null },
    };
  });
  const ids: MacroFactorId[] = ["rate", "rateTrend", "growth", "jobs"];
  // Higher rates, hikes and growth favour a currency; rising unemployment counts against it.
  const scores = Object.fromEntries(ids.map((id) => [id, relative(raw.map((r) => (r[id].value === null ? null : id === "jobs" ? -r[id].value! : r[id].value)))])) as Record<MacroFactorId, (number | null)[]>;
  return inputs.map((input, n) => {
    const factors = ids.map((id) => ({ id, value: raw[n][id].value, date: raw[n][id].date, score: scores[id][n] }));
    const have = factors.map((f) => f.score).filter((s): s is number => s !== null);
    return { key: input.key, factors, score: have.length ? Math.round((have.reduce((a, b) => a + b, 0) / have.length) * 100) / 100 : null };
  });
}

/** Quarter-on-quarter % change from a level series, for economies FRED only has as levels. */
export const quarterOnQuarter = (obs: Observation[]): Observation[] =>
  obs.slice(1).map((o, i) => ({ date: o.date, value: Math.round((o.value / obs[i].value - 1) * 10000) / 100 }));
