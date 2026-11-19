/**
 * Seasonality and trend for one market, from its daily closes. Seasonality: how the current calendar month has gone
 * in past years. Trend: whether the latest close is above its 20, 50 and 200-day averages.
 */

export interface DailyClose {
  t: number; // seconds, UTC
  c: number;
}

export interface Seasonality {
  month: number; // 0–11
  /** Average return over the month, %. */
  avgPct: number;
  upYears: number;
  years: number;
  /** −1…+1: (years up − years down) / years. */
  score: number;
}

export interface Trend {
  /** True when the latest close is above that average, null with too little history. */
  above: Record<"20" | "50" | "200", boolean | null>;
  /** −1…+1: the share of the averages it's above, less the share it's below. */
  score: number | null;
}

export const MIN_YEARS = 5;
const AVERAGES = [20, 50, 200] as const;

/** A daily bar's own day. Its time is the broker's midnight in UTC, up to 12 hours either side, so noon lands inside it. */
const dayOf = (t: number) => new Date((t + 12 * 3600) * 1000);

/** The last close of each month, keyed year*12+month. Closes oldest first. */
function monthEnds(closes: DailyClose[]): Map<number, number> {
  const ends = new Map<number, number>();
  for (const b of closes) {
    const d = dayOf(b.t);
    ends.set(d.getUTCFullYear() * 12 + d.getUTCMonth(), b.c);
  }
  return ends;
}

/** The month's past record, in full years before `now`'s. Null with fewer than MIN_YEARS of them. */
export function seasonality(closes: DailyClose[], now = new Date()): Seasonality | null {
  const month = now.getUTCMonth();
  const ends = monthEnds(closes);
  const returns: number[] = [];
  for (let year = now.getUTCFullYear() - 1; year >= now.getUTCFullYear() - 20; year--) {
    const key = year * 12 + month;
    const [end, start] = [ends.get(key), ends.get(key - 1)];
    if (end !== undefined && start !== undefined) returns.push(end / start - 1);
  }
  if (returns.length < MIN_YEARS) return null;
  const up = returns.filter((r) => r > 0).length;
  const down = returns.filter((r) => r < 0).length;
  return {
    month,
    avgPct: Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 10000) / 100,
    upYears: up,
    years: returns.length,
    score: Math.round(((up - down) / returns.length) * 100) / 100,
  };
}

export function trend(closes: DailyClose[]): Trend {
  const last = closes.at(-1)?.c;
  const above = Object.fromEntries(
    AVERAGES.map((n) => {
      if (last === undefined || closes.length < n) return [String(n), null];
      const avg = closes.slice(-n).reduce((a, b) => a + b.c, 0) / n;
      return [String(n), last > avg];
    }),
  ) as Trend["above"];
  const known = Object.values(above).filter((v): v is boolean => v !== null);
  return { above, score: known.length ? Math.round((known.reduce((a, v) => a + (v ? 1 : -1), 0) / known.length) * 100) / 100 : null };
}
