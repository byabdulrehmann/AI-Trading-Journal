/**
 * Jarvis's positioning scorecard, built only from the CFTC's weekly Commitments of Traders report.
 * For each market: where large speculators' net position sits within its own 3-year range (the COT index),
 * and how it moved this week. A pair compares its two currencies, adding the macro (macro.ts) and surprise
 * (surprise.ts) scores when there are any.
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
  weeklyChange: number;
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
  /** Whichever of the three exist, averaged. */
  score: number;
  bias: "bullish" | "bearish" | "neutral";
}

export const RANGE_WEEKS = 156;

/** Weeks must be oldest first. Null when there's no report yet. */
export function scoreAsset(key: string, name: string, weeks: CotWeek[]): AssetPositioning | null {
  const last = weeks.at(-1);
  if (!last) return null;
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
    weeklyChange: nets.length > 1 ? net - nets.at(-2)! : 0,
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
export function scorePair(base: AssetPositioning, quote: AssetPositioning, macroScores: Both = [null, null], surpriseScores: Both = [null, null]): PairPositioning {
  const cot = round((base.score - quote.score) / 2);
  const macro = spread(macroScores);
  const surprise = spread(surpriseScores);
  const parts = [cot, macro, surprise].filter((x): x is number => x !== null);
  const score = round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return { symbol: base.key + quote.key, base: base.key, quote: quote.key, cot, macro, surprise, score, bias: biasOf(score) };
}
