/**
 * Jarvis's positioning scorecard, built only from the CFTC's weekly Commitments of Traders report.
 * For each market: where large speculators' net position sits within its own 3-year range (the COT index),
 * and how it moved this week. A pair compares its two currencies, adding the macro (macro.ts) and surprise
 * (surprise.ts) scores, and the pair's own seasonality and trend (seasonal.ts), when there are any.
 * Context for a review, not a trade signal.
 */

export interface CotWeek {
  date: string; // YYYY-MM-DD, the Tuesday the positions are as of
  long: number;
  short: number;
  openInterest: number;
}

export interface AssetPositioning {
  key: string;
  name: string;
  date: string;
  net: number;
  /** Net as a share of open interest, −100…100. */
  netPct: number;
  /** Against the report a week before. Null when that week is missing. */
  weeklyChange: number | null;
  /** 0–100: where this week's net sits between its 3-year low and high. */
  cotIndex: number;
  /** −1…+1, from the COT index. */
  score: number;
  /** In the top or bottom tenth of its 3-year range. */
  crowded: boolean;
  /** Net position each week, oldest first, for the last year. */
  history: number[];
}

export interface PairPositioning {
  symbol: string;
  base: string;
  quote: string;
  /** From positioning alone. */
  cot: number;
  /** From the FRED macro scores, when both currencies have one. */
  macro: number | null;
  /** From the user's economic calendar surprises, when both currencies have one. */
  surprise: number | null;
  /** The pair's own record in this month of past years (seasonal.ts). */
  seasonal: number | null;
  /** The pair against its 20, 50 and 200-day averages (seasonal.ts). */
  trend: number | null;
  /** Whichever of these exist, averaged. */
  score: number;
  bias: "bullish" | "bearish" | "neutral";
}

export const RANGE_WEEKS = 156;
const WEEK = 7 * 86_400_000;

/** Weeks must be oldest first. Null when there's no report yet. */
export function scoreAsset(key: string, name: string, weeks: CotWeek[]): AssetPositioning | null {
  const last = weeks.at(-1);
  if (!last) return null;
  const prev = weeks.at(-2);
  const nets = weeks.slice(-RANGE_WEEKS).map((w) => w.long - w.short);
  const net = nets.at(-1)!;
  const lo = Math.min(...nets);
  const hi = Math.max(...nets);
  const cotIndex = hi === lo ? 50 : Math.round(((net - lo) / (hi - lo)) * 100);
  return {
    key,
    name,
    date: last.date,
    net,
    netPct: last.openInterest ? Math.round((net / last.openInterest) * 1000) / 10 : 0,
    weeklyChange: prev && Date.parse(last.date) - Date.parse(prev.date) === WEEK ? net - (prev.long - prev.short) : null,
    cotIndex,
    score: (cotIndex - 50) / 50,
    crowded: cotIndex >= 90 || cotIndex <= 10,
    history: nets.slice(-52),
  };
}

export const biasOf = (score: number): PairPositioning["bias"] => (score > 0.15 ? "bullish" : score < -0.15 ? "bearish" : "neutral");

const round = (n: number) => Math.round(n * 100) / 100;

type Both = [base: number | null, quote: number | null];
const spread = ([b, q]: Both) => (b === null || q === null ? null : round((b - q) / 2));

/** A pair is bullish when speculators, and the macro backdrop and recent releases where known, favour the base over the quote. */
export function scorePair(
  base: AssetPositioning,
  quote: AssetPositioning,
  macroScores: Both = [null, null],
  surpriseScores: Both = [null, null],
  { seasonal = null, trend = null }: { seasonal?: number | null; trend?: number | null } = {},
): PairPositioning {
  const cot = round((base.score - quote.score) / 2);
  const macro = spread(macroScores);
  const surprise = spread(surpriseScores);
  const parts = [cot, macro, surprise, seasonal, trend].filter((x): x is number => x !== null);
  const score = round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return { symbol: base.key + quote.key, base: base.key, quote: quote.key, cot, macro, surprise, seasonal, trend, score, bias: biasOf(score) };
}
