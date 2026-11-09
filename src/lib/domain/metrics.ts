import type { Account, Trade } from "./types";
import { round } from "./trade-math";
import { pipsBetween } from "./engine/instruments";
import { addMoney } from "./engine/position";
import { computeStats } from "./engine/stats";
import { zoneDateKey, zoneParts } from "./zone";

/** Currencies that have trades, plus the one to report in first. Money in different currencies never adds up. */
export function reportingCurrencies(accounts: Account[], trades: Trade[]): { currencies: string[]; primary: string | null } {
  const used = accounts.filter((a) => trades.some((t) => t.accountId === a.id));
  return {
    currencies: [...new Set(used.map((a) => a.currency))],
    primary: (used.find((a) => !a.archived) ?? used[0] ?? accounts.find((a) => !a.archived))?.currency ?? null,
  };
}

export function tradesInCurrency(trades: Trade[], accounts: Account[], currency: string): Trade[] {
  const ids = new Set(accounts.filter((a) => a.currency === currency).map((a) => a.id));
  return trades.filter((t) => ids.has(t.accountId));
}

export interface MetricDefinition {
  label: string;
  formula: string;
  meaning: string;
}

/** Shown next to every number so the user can check how it was produced. */
export const METRIC_DEFINITIONS = {
  netPnl: {
    label: "Net P&L",
    formula: "Σ (exit − avg entry) × direction × size × multiplier × fx − costs",
    meaning: "Total profit or loss of closed trades after fees.",
  },
  winRate: {
    label: "Win rate",
    formula: "winning trades ÷ closed trades",
    meaning: "Share of closed trades with P&L above zero. Break-even trades count as non-wins.",
  },
  profitFactor: {
    label: "Profit factor",
    formula: "gross profit ÷ |gross loss|",
    meaning: "Above 1 means winners earned more than losers cost. Not applicable when there are no losses.",
  },
  expectancy: {
    label: "Expectancy",
    formula: "net P&L ÷ closed trades",
    meaning: "Average result per closed trade.",
  },
  avgR: {
    label: "Average R",
    formula: "mean of (net P&L ÷ planned risk)",
    meaning: "Average result in units of the risk you planned. Only trades with a stop count.",
  },
  maxDrawdown: {
    label: "Max drawdown",
    formula: "largest fall from a running equity peak",
    meaning: "Worst peak-to-trough drop of cumulative P&L, in money.",
  },
  planAdherence: {
    label: "Plan adherence",
    formula: "trades marked ‘followed plan’ ÷ trades with an answer",
    meaning: "How often you reported sticking to your plan. Unanswered trades are excluded.",
  },
  avgWin: {
    label: "Average win",
    formula: "gross profit ÷ winning trades",
    meaning: "Mean P&L of winning trades.",
  },
  avgLoss: {
    label: "Average loss",
    formula: "gross loss ÷ losing trades",
    meaning: "Mean P&L of losing trades.",
  },
  holdWinners: {
    label: "Median hold, winners",
    formula: "median(close − open) of winners",
    meaning: "Typical time a winning trade stays open.",
  },
  holdLosers: {
    label: "Median hold, losers",
    formula: "median(close − open) of losers",
    meaning: "Typical time a losing trade stays open.",
  },
  totalTrades: {
    label: "Total trades",
    formula: "count of trades matching the filters",
    meaning: "Open, partly closed and closed trades.",
  },
  closedTrades: {
    label: "Closed",
    formula: "trades fully exited with a known P&L",
    meaning: "Every result uses these. A trade missing a conversion rate isn't counted until the rate is entered.",
  },
  openTrades: {
    label: "Open",
    formula: "trades with size still on",
    meaning: "Includes partly closed trades. Not part of realized results.",
  },
  wins: {
    label: "Winning",
    formula: "closed trades with net P&L > 0",
    meaning: "Costs are included, so a small gross win can become a loss.",
  },
  losses: {
    label: "Losing",
    formula: "closed trades with net P&L < 0",
    meaning: "Costs are included.",
  },
  breakeven: {
    label: "Breakeven",
    formula: "closed trades with net P&L = 0",
    meaning: "Neither a win nor a loss. Lowers the win rate and ends a streak.",
  },
  grossProfit: {
    label: "Gross profit",
    formula: "Σ net P&L of winning trades",
    meaning: "What winners earned, after each winner's own costs.",
  },
  grossLoss: {
    label: "Gross loss",
    formula: "Σ net P&L of losing trades",
    meaning: "What losers cost, after each loser's own costs.",
  },
  totalFees: {
    label: "Total fees",
    formula: "Σ commission + swap + other fees",
    meaning: "Closed trades only. Positive is a cost, negative a net credit.",
  },
  bestTrade: {
    label: "Best trade",
    formula: "max(net P&L)",
    meaning: "The largest single closed result.",
  },
  worstTrade: {
    label: "Worst trade",
    formula: "min(net P&L)",
    meaning: "The smallest single closed result.",
  },
  avgHold: {
    label: "Avg holding time",
    formula: "mean(close − open) of closed trades",
    meaning: "From the first entry to the last exit.",
  },
  maxConsecutiveWins: {
    label: "Consecutive wins",
    formula: "longest run of wins, in closing order",
    meaning: "A breakeven trade ends the run.",
  },
  maxConsecutiveLosses: {
    label: "Consecutive losses",
    formula: "longest run of losses, in closing order",
    meaning: "A breakeven trade ends the run.",
  },
  avgMfe: {
    label: "Average best point",
    formula: "mean of MFE ÷ stop distance",
    meaning: "How far trades went your way at their best, in R. Maximum favourable excursion, read from price bars.",
  },
  avgMae: {
    label: "Average worst point",
    formula: "mean of MAE ÷ stop distance",
    meaning: "How far trades went against you at their worst, in R. Maximum adverse excursion, read from price bars.",
  },
  leftBehind: {
    label: "Left on the table",
    formula: "mean of (MFE in R − R at exit), on winners",
    meaning: "How much more winners had at their best than they closed with, before costs.",
  },
  stopShare: {
    label: "Trades with a stop",
    formula: "closed trades with a stop ÷ closed trades",
    meaning: "A trade with no stop has no defined risk, so it has no R.",
  },
  avgRisk: {
    label: "Average planned risk",
    formula: "mean of |entry − stop| × size × multiplier",
    meaning: "What a trade stood to lose at its stop. Only trades with a stop count.",
  },
  beyondPlan: {
    label: "Losses past the stop",
    formula: "closed trades whose loss before costs is over 1% past their planned risk",
    meaning: "Price went further than the stop allowed for, through slippage or moving the stop. Costs alone don't count.",
  },
  ruleAdherence: {
    label: "Rule adherence",
    formula: "rules followed ÷ rules answered, on reviewed trades",
    meaning: "How much of your playbook you actually followed. Trades you haven't reviewed don't count either way.",
  },
  payoffRatio: {
    label: "Payoff ratio",
    formula: "average win ÷ |average loss|",
    meaning: "How much a typical win earns against what a typical loss costs. Needs at least one of each.",
  },
  recoveryFactor: {
    label: "Recovery factor",
    formula: "net P&L ÷ max drawdown",
    meaning: "Profit made for each unit of the deepest drawdown. Blank until there has been a drawdown.",
  },
  avgPlannedR: {
    label: "Average planned R",
    formula: "mean of (target distance ÷ stop distance)",
    meaning: "The reward you aimed for per unit of risk. Only trades with a stop and a target count.",
  },
  currentStreak: {
    label: "Current streak",
    formula: "wins (+) or losses (−) in a row, up to the latest closed trade",
    meaning: "A breakeven trade resets it to zero.",
  },
  dayWinRate: {
    label: "Winning days",
    formula: "days with net P&L > 0 ÷ days with a closed trade",
    meaning: "Results land on the day a trade closed.",
  },
  avgDailyPnl: {
    label: "Average day",
    formula: "net P&L ÷ days with a closed trade",
    meaning: "Days with no closed trade aren't counted.",
  },
  bestDay: {
    label: "Best day",
    formula: "max(net P&L of a day)",
    meaning: "The day with the largest total.",
  },
  worstDay: {
    label: "Worst day",
    formula: "min(net P&L of a day)",
    meaning: "The day with the smallest total.",
  },
} satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export interface Metrics {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  /** Closed, but missing a conversion rate or with bad fills: left out of every figure. */
  excludedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  totalFees: number;
  avgHoldMin: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  rSample: number;
  maxDrawdown: number;
  planAdherence: number | null;
  planSample: number;
  avgWin: number | null;
  avgLoss: number | null;
  holdWinnersMin: number | null;
  holdLosersMin: number | null;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  payoffRatio: number | null;
  recoveryFactor: number | null;
  avgPlannedR: number | null;
  /** Positive for wins in a row, negative for losses, zero after a breakeven or with no trades. */
  currentStreak: number;
  tradingDays: number;
  winningDays: number;
  losingDays: number;
  /** The sum of the days that ended up, for the consistency axis. */
  winningDaysPnl: number;
  dayWinRate: number | null;
  avgDailyPnl: number | null;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
}

export const isClosed = (t: Trade): t is Trade & { pnl: number; closedAt: string; exitPrice: number } =>
  t.status === "closed" && t.pnlStatus === "ok" && t.pnl !== null && t.closedAt !== null;

export function holdMinutes(t: Trade): number | null {
  if (!t.closedAt) return null;
  return (Date.parse(t.closedAt) - Date.parse(t.openedAt)) / 60000;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeMetrics(trades: Trade[], tz?: string): Metrics {
  const closed = trades.filter(isClosed).sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const s = computeStats(closed.map((t) => t.pnl));
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);
  const withR = closed.filter((t) => t.rMultiple !== null);
  const planAnswered = trades.filter((t) => t.followedPlan !== null);
  const holds = closed.map((t) => holdMinutes(t) as number);
  const byPnl = [...closed].sort((a, b) => b.pnl - a.pnl);
  const planned = closed.filter((t) => t.plannedR !== null).map((t) => t.plannedR as number);
  const days = [...dailySummaries(closed, tz).values()].sort((a, b) => b.pnl - a.pnl);
  const dayOf = (d: DaySummary | undefined) => (d ? { date: d.date, pnl: d.pnl } : null);
  return {
    totalTrades: trades.length,
    closedTrades: s.closed,
    openTrades: trades.filter((t) => t.status !== "closed").length,
    excludedTrades: trades.filter((t) => t.status === "closed" && t.pnlStatus !== "ok").length,
    wins: s.wins,
    losses: s.losses,
    breakeven: s.breakeven,
    netPnl: s.netPnl,
    grossProfit: s.grossProfit,
    grossLoss: s.grossLoss,
    totalFees: addMoney(closed.flatMap((t) => [t.commission, t.swap, t.otherFees])),
    winRate: s.winRate === null ? null : s.winRate / 100,
    // JSON can't carry Infinity, so "no losses" travels as null and the page shows it from the counts.
    profitFactor: s.profitFactor,
    expectancy: s.expectancy,
    avgR: withR.length ? round(withR.reduce((a, t) => a + (t.rMultiple as number), 0) / withR.length, 2) : null,
    rSample: withR.length,
    maxDrawdown: s.maxDrawdown,
    maxConsecutiveWins: s.maxConsecutiveWins,
    maxConsecutiveLosses: s.maxConsecutiveLosses,
    planAdherence: planAnswered.length ? planAnswered.filter((t) => t.followedPlan).length / planAnswered.length : null,
    planSample: planAnswered.length,
    avgWin: s.avgWin,
    avgLoss: s.avgLoss,
    avgHoldMin: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
    holdWinnersMin: median(winners.map((t) => holdMinutes(t) as number)),
    holdLosersMin: median(losers.map((t) => holdMinutes(t) as number)),
    bestTrade: byPnl[0] ?? null,
    worstTrade: byPnl.at(-1) ?? null,
    payoffRatio: s.avgWin !== null && s.avgLoss !== null ? round(s.avgWin / Math.abs(s.avgLoss), 2) : null,
    recoveryFactor: s.maxDrawdown > 0 ? round(s.netPnl / s.maxDrawdown, 2) : null,
    avgPlannedR: planned.length ? round(planned.reduce((a, b) => a + b, 0) / planned.length, 2) : null,
    currentStreak: currentStreak(closed.map((t) => t.pnl)),
    tradingDays: days.length,
    winningDays: days.filter((d) => d.pnl > 0).length,
    losingDays: days.filter((d) => d.pnl < 0).length,
    winningDaysPnl: addMoney(days.filter((d) => d.pnl > 0).map((d) => d.pnl)),
    dayWinRate: days.length ? days.filter((d) => d.pnl > 0).length / days.length : null,
    avgDailyPnl: days.length ? round(s.netPnl / days.length, 2) : null,
    bestDay: dayOf(days[0]),
    worstDay: dayOf(days.at(-1)),
  };
}

function currentStreak(pnls: number[]): number {
  const last = pnls.at(-1);
  if (!last) return 0;
  let run = 0;
  for (let i = pnls.length - 1; i >= 0 && Math.sign(pnls[i]) === Math.sign(last); i--) run++;
  return last > 0 ? run : -run;
}

export interface EquityPoint {
  tradeId: number;
  at: string;
  equity: number;
}

export function equityCurve(trades: Trade[]): EquityPoint[] {
  let equity = 0;
  return trades
    .filter(isClosed)
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt))
    .map((t) => {
      equity = addMoney([equity, t.pnl]);
      return { tradeId: t.id, at: t.closedAt, equity };
    });
}

export interface DrawdownPoint {
  at: string;
  drawdown: number;
}

/** Fall from the running peak after each closed trade. Zero at a new high, negative below it. */
export function drawdownCurve(trades: Trade[]): DrawdownPoint[] {
  let peak = 0;
  return equityCurve(trades).map((p) => {
    peak = Math.max(peak, p.equity);
    return { at: p.at, drawdown: addMoney([p.equity, -peak]) };
  });
}

export type Period = "day" | "week" | "month" | "year";

/** The bucket a local date falls in. Weeks start on Monday. */
export function periodKey(iso: string, period: Period, tz?: string): string {
  const day = localDateKey(iso, tz);
  if (period === "day") return day;
  if (period === "month") return day.slice(0, 7);
  if (period === "year") return day.slice(0, 4);
  const p = zoneParts(Date.parse(iso), tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day - ((p.weekday + 6) % 7))).toISOString().slice(0, 10);
}

export interface PeriodRow {
  key: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export function periodSummaries(trades: Trade[], period: Period, tz?: string): PeriodRow[] {
  const rows = new Map<string, PeriodRow>();
  for (const t of trades.filter(isClosed)) {
    const key = periodKey(t.closedAt, period, tz);
    const r = rows.get(key) ?? { key, pnl: 0, trades: 0, wins: 0, losses: 0 };
    r.pnl = addMoney([r.pnl, t.pnl]);
    r.trades += 1;
    if (t.pnl > 0) r.wins += 1;
    if (t.pnl < 0) r.losses += 1;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Win/loss distribution: counts of closed trades per P&L bucket of equal width. */
export function pnlDistribution(trades: Trade[], buckets = 12): { from: number; to: number; count: number }[] {
  const values = trades.filter(isClosed).map((t) => t.pnl);
  if (values.length === 0) return [];
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const width = (max - min) / buckets || 1;
  const out = Array.from({ length: buckets }, (_, i) => ({ from: round(min + i * width), to: round(min + (i + 1) * width), count: 0 }));
  for (const v of values) out[Math.min(buckets - 1, Math.floor((v - min) / width))].count += 1;
  return out;
}

export interface DaySummary {
  date: string; // YYYY-MM-DD in local time
  pnl: number;
  trades: number;
  tradeIds: number[];
}

export function localDateKey(iso: string, tz?: string): string {
  return zoneDateKey(iso, tz);
}

/** Groups closed trades by the local calendar day they closed. */
export function dailySummaries(trades: Trade[], tz?: string): Map<string, DaySummary> {
  const days = new Map<string, DaySummary>();
  for (const t of trades.filter(isClosed)) {
    const key = localDateKey(t.closedAt, tz);
    const d = days.get(key) ?? { date: key, pnl: 0, trades: 0, tradeIds: [] };
    d.pnl = addMoney([d.pnl, t.pnl]);
    d.trades += 1;
    d.tradeIds.push(t.id);
    days.set(key, d);
  }
  return days;
}

export interface BreakdownRow {
  key: string;
  trades: number;
  netPnl: number;
  winRate: number;
}

export function breakdown(trades: Trade[], keyOf: (t: Trade) => string | null): BreakdownRow[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades.filter(isClosed)) {
    const k = keyOf(t);
    if (!k) continue;
    const group = groups.get(k);
    if (group) group.push(t);
    else groups.set(k, [t]);
  }
  return [...groups.entries()].map(([key, ts]) => breakdownRow(key, ts)).sort((a, b) => b.netPnl - a.netPnl);
}

function breakdownRow(key: string, ts: Trade[]): BreakdownRow {
  return {
    key,
    trades: ts.length,
    netPnl: addMoney(ts.map((t) => t.pnl as number)),
    winRate: ts.filter((t) => (t.pnl as number) > 0).length / ts.length,
  };
}

/** For a field holding several values, such as tags: a trade counts once in each, so rows can add up to more than the total. */
export function breakdownMany(trades: Trade[], keysOf: (t: Trade) => string[]): BreakdownRow[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades.filter(isClosed)) {
    for (const k of new Set(keysOf(t))) groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].map(([key, ts]) => breakdownRow(key, ts)).sort((a, b) => b.netPnl - a.netPnl);
}

/** A band from `from` up to, but not including, `to`. A missing end is open. */
export interface Bucket {
  key: string;
  from?: number;
  to?: number;
}

export const HOLD_BUCKETS: Bucket[] = [
  { key: "Under 5 min", to: 5 },
  { key: "5 to 15 min", from: 5, to: 15 },
  { key: "15 to 60 min", from: 15, to: 60 },
  { key: "1 to 4 hours", from: 60, to: 240 },
  { key: "4 to 24 hours", from: 240, to: 1440 },
  { key: "A day or more", from: 1440 },
];

export const R_BUCKETS: Bucket[] = [
  { key: "Below −2R", to: -2 },
  { key: "−2R to −1R", from: -2, to: -1 },
  { key: "−1R to 0R", from: -1, to: 0 },
  { key: "0R to 1R", from: 0, to: 1 },
  { key: "1R to 2R", from: 1, to: 2 },
  { key: "2R or more", from: 2 },
];

export const PRICE_BUCKETS: Bucket[] = [
  { key: "Under 10", to: 10 },
  { key: "10 to 50", from: 10, to: 50 },
  { key: "50 to 200", from: 50, to: 200 },
  { key: "200 to 1,000", from: 200, to: 1000 },
  { key: "1,000 to 10,000", from: 1000, to: 10000 },
  { key: "10,000 or more", from: 10000 },
];

export const SIZE_BUCKETS: Bucket[] = [
  { key: "Under 1", to: 1 },
  { key: "1 to 10", from: 1, to: 10 },
  { key: "10 to 100", from: 10, to: 100 },
  { key: "100 to 1,000", from: 100, to: 1000 },
  { key: "1,000 or more", from: 1000 },
];

/** Rows in band order, skipping empty bands and trades with no value, such as no R without a stop. */
export function bucketBreakdown(trades: Trade[], valueOf: (t: Trade) => number | null, buckets: Bucket[]): BreakdownRow[] {
  const closed = trades.filter(isClosed);
  return buckets.flatMap((b) => {
    const ts = closed.filter((t) => {
      const v = valueOf(t);
      return v !== null && v >= (b.from ?? -Infinity) && v < (b.to ?? Infinity);
    });
    return ts.length ? [breakdownRow(b.key, ts)] : [];
  });
}

// ---------- the score ----------

export const SCORE_MIN_TRADES = 20;
export const SCORE_MIN_DAYS = 5;

export interface ScoreAxis extends MetricDefinition {
  key: string;
  /** 0 to 100. Null when these trades can't say, and then it sits out of the total. */
  value: number | null;
  weight: number;
  /** The measurement the axis is scored from, before scaling. Null when there isn't one. */
  raw: number | null;
  /** Why it's blank. */
  missing?: string;
}

export interface Score {
  /** Null until there are enough trades for a total to mean something. */
  score: number | null;
  axes: ScoreAxis[];
  needs: { trades: number; days: number };
}

/** Straight lines between anchor points, flat beyond the ends. */
export function ramp(x: number, anchors: [number, number][]): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return anchors[anchors.length - 1][1];
}

export const SCORE_ANCHORS = {
  winRate: [[0.2, 0], [0.4, 50], [0.6, 100]],
  profitFactor: [[0.5, 0], [1, 40], [1.5, 70], [2.5, 100]],
  avgWinLoss: [[0.5, 0], [1, 40], [2, 75], [3, 100]],
  recoveryFactor: [[-1, 0], [0, 30], [1, 50], [3, 80], [6, 100]],
  maxDrawdown: [[1, 100], [3, 80], [6, 50], [10, 20], [15, 0]],
  consistency: [[0.15, 100], [0.3, 75], [0.5, 40], [1, 0]],
} satisfies Record<string, [number, number][]>;

/**
 * The Jarvis Performance Score: six axes, each scaled 0 to 100 by straight lines between stated anchors, then a
 * weighted mean of the axes that have a value. Method, anchors and reasons: docs/performance-score.md. Money-based
 * axes are ratios, so account size doesn't change them.
 */
export function computeScore(m: Metrics): Score {
  const noLosses = m.losses === 0 && m.wins > 0;
  const ddInLosses = m.maxDrawdown === 0 ? 0 : m.avgLoss ? m.maxDrawdown / Math.abs(m.avgLoss) : null;
  const bestShare = m.winningDays > 0 && m.bestDay && m.winningDaysPnl > 0 ? m.bestDay.pnl / m.winningDaysPnl : null;
  const axes: ScoreAxis[] = [
    {
      key: "winRate",
      label: "Win %",
      weight: 15,
      formula: "winning trades ÷ closed trades: 20% = 0, 40% = 50, 60% = 100",
      meaning: "How often a trade ends in profit. Weight 15.",
      raw: m.winRate,
      value: m.winRate === null ? null : ramp(m.winRate, SCORE_ANCHORS.winRate),
    },
    {
      key: "profitFactor",
      label: "Profit factor",
      weight: 20,
      formula: "gross profit ÷ gross loss: 0.5 = 0, 1 = 40, 1.5 = 70, 2.5 = 100",
      meaning: "How much winners earned against what losers cost. No losses scores 100. Weight 20.",
      raw: m.profitFactor,
      value: m.profitFactor !== null ? ramp(m.profitFactor, SCORE_ANCHORS.profitFactor) : noLosses ? 100 : null,
    },
    {
      key: "avgWinLoss",
      label: "Avg win/loss",
      weight: 15,
      formula: "average win ÷ |average loss|: 0.5 = 0, 1 = 40, 2 = 75, 3 = 100",
      meaning: "How big a typical winner is next to a typical loser. No losses scores 100. Weight 15.",
      raw: m.payoffRatio,
      value: m.payoffRatio !== null ? ramp(m.payoffRatio, SCORE_ANCHORS.avgWinLoss) : noLosses ? 100 : null,
    },
    {
      key: "recoveryFactor",
      label: "Recovery factor",
      weight: 20,
      formula: "net P&L ÷ deepest drawdown: −1 = 0, 0 = 30, 1 = 50, 3 = 80, 6 = 100",
      meaning: "Profit made for each unit of the deepest fall. A profit with no drawdown scores 100. Weight 20.",
      raw: m.recoveryFactor,
      value: m.recoveryFactor !== null ? ramp(m.recoveryFactor, SCORE_ANCHORS.recoveryFactor) : m.closedTrades && m.netPnl > 0 ? 100 : null,
    },
    {
      key: "maxDrawdown",
      label: "Max drawdown",
      weight: 15,
      formula: "deepest drawdown ÷ |average loss|: 1 = 100, 3 = 80, 6 = 50, 10 = 20, 15 = 0",
      meaning: "The deepest fall from a peak, counted in typical losses, so account size doesn't matter. Weight 15.",
      raw: ddInLosses,
      value: m.closedTrades === 0 || ddInLosses === null ? null : ramp(ddInLosses, SCORE_ANCHORS.maxDrawdown),
    },
    {
      key: "consistency",
      label: "Consistency",
      weight: 15,
      formula: "best day ÷ all winning days' profit: 15% = 100, 30% = 75, 50% = 40, 100% = 0",
      meaning: "Whether profit is spread over many days or rests on one. No winning day scores 0. Weight 15.",
      raw: bestShare,
      value: m.tradingDays === 0 ? null : bestShare === null ? 0 : ramp(bestShare, SCORE_ANCHORS.consistency),
    },
  ];
  const known = axes.filter((a) => a.value !== null);
  const weight = known.reduce((t, a) => t + a.weight, 0);
  const enough = m.closedTrades >= SCORE_MIN_TRADES && m.tradingDays >= SCORE_MIN_DAYS && weight > 0;
  return {
    score: enough ? Math.round(known.reduce((t, a) => t + (a.value as number) * a.weight, 0) / weight * 100) / 100 : null,
    axes,
    needs: { trades: SCORE_MIN_TRADES, days: SCORE_MIN_DAYS },
  };
}

// ---------- display units ----------

export const UNITS = ["money", "percent", "r", "pips"] as const;
export type Unit = (typeof UNITS)[number];

/**
 * The same trades with each result restated, so every figure and chart is worked out once, whatever the unit.
 * Closed trades the unit can't express are left out, and the caller says how many. Costs stay in money.
 */
export function tradesInUnit(trades: Trade[], unit: Unit, opts: { balances?: Map<number, number>; digits?: (t: Trade) => number | null } = {}): { trades: Trade[]; left: number; base: number } {
  if (unit === "money") return { trades, left: 0, base: 0 };
  const used = [...new Set(trades.map((t) => t.accountId))];
  const base = used.reduce((total, id) => total + (opts.balances?.get(id) ?? 0), 0);
  const restate = (t: Trade): number | null => {
    if (!isClosed(t)) return null;
    if (unit === "r") return t.rMultiple;
    if (unit === "percent") return base > 0 && (opts.balances?.get(t.accountId) ?? 0) > 0 ? round((t.pnl / base) * 100, 4) : null;
    return pipsBetween(t.symbol, t.side, t.entryPrice, t.exitPrice, opts.digits?.(t));
  };
  let left = 0;
  const out = trades.flatMap((t) => {
    if (!isClosed(t)) return [t];
    const value = restate(t);
    if (value === null) {
      left++;
      return [];
    }
    return [{ ...t, pnl: value }];
  });
  return { trades: out, left, base };
}

// ---------- playbooks ----------

export interface PlaybookStats {
  closed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  netPnl: number;
  avgR: number | null;
  rSample: number;
  /** Closed trades checked against the rules. */
  reviewed: number;
  /** Open trades checked against the rules: in adherence, not in results. */
  openReviewed: number;
  adherence: number | null;
  onRule: BreakdownRow | null;
  offRule: BreakdownRow | null;
}

/** One playbook's trades. Results use closed trades, as everywhere. Adherence also counts open trades that were reviewed. */
export function playbookStats(trades: Trade[], checks: Map<number, { done: number; total: number }>): PlaybookStats {
  const m = computeMetrics(trades);
  const answered = trades.filter((t) => checks.has(t.id));
  const closed = answered.filter(isClosed);
  const totals = answered.reduce((a, t) => {
    const c = checks.get(t.id) as { done: number; total: number };
    return { done: a.done + c.done, total: a.total + c.total };
  }, { done: 0, total: 0 });
  const row = (key: string, ts: Trade[]) => (ts.length ? breakdownRow(key, ts) : null);
  const full = (t: Trade) => {
    const c = checks.get(t.id) as { done: number; total: number };
    return c.done === c.total;
  };
  return {
    closed: m.closedTrades,
    wins: m.wins,
    losses: m.losses,
    winRate: m.winRate,
    profitFactor: m.profitFactor,
    expectancy: m.expectancy,
    netPnl: m.netPnl,
    avgR: m.avgR,
    rSample: m.rSample,
    reviewed: closed.length,
    openReviewed: answered.length - closed.length,
    adherence: totals.total ? totals.done / totals.total : null,
    onRule: row("followed", closed.filter(full)),
    offRule: row("missed", closed.filter((t) => !full(t))),
  };
}

export interface MissedSummary {
  count: number;
  /** How many have both a stop and an exit, so an R. */
  rSample: number;
  totalR: number;
  avgR: number | null;
}

export function missedSummary(missed: { r: number | null }[]): MissedSummary {
  const rs = missed.flatMap((m) => (m.r === null ? [] : [m.r]));
  const totalR = round(rs.reduce((a, b) => a + b, 0), 2);
  return { count: missed.length, rSample: rs.length, totalR, avgR: rs.length ? round(totalR / rs.length, 2) : null };
}

// ---------- reports ----------

export interface SideProfile {
  trades: number;
  total: number;
  avg: number | null;
  median: number | null;
  /** Furthest from zero. */
  largest: number | null;
  avgHoldMin: number | null;
}

function sideProfile(trades: (Trade & { pnl: number })[]): SideProfile {
  const pnls = trades.map((t) => t.pnl);
  const holds = trades.map((t) => holdMinutes(t) as number);
  const total = addMoney(pnls);
  return {
    trades: trades.length,
    total,
    avg: trades.length ? round(total / trades.length, 2) : null,
    median: median(pnls),
    largest: trades.length ? pnls.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null,
    avgHoldMin: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
  };
}

export function winLossProfile(trades: Trade[]): { wins: SideProfile; losses: SideProfile } {
  const closed = trades.filter(isClosed);
  return { wins: sideProfile(closed.filter((t) => t.pnl > 0)), losses: sideProfile(closed.filter((t) => t.pnl < 0)) };
}

/** How many runs of each length, in closing order. A breakeven trade ends a run and starts none. */
export function streakRuns(trades: Trade[]): { length: number; wins: number; losses: number }[] {
  const closed = trades.filter(isClosed).sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const counts = new Map<number, { wins: number; losses: number }>();
  const close = (kind: "wins" | "losses", length: number) => {
    if (!length) return;
    const row = counts.get(length) ?? { wins: 0, losses: 0 };
    row[kind]++;
    counts.set(length, row);
  };
  let [wins, losses] = [0, 0];
  for (const t of closed) {
    if (t.pnl <= 0) {
      close("wins", wins);
      wins = 0;
    }
    if (t.pnl >= 0) {
      close("losses", losses);
      losses = 0;
    }
    if (t.pnl > 0) wins++;
    if (t.pnl < 0) losses++;
  }
  close("wins", wins);
  close("losses", losses);
  return [...counts].map(([length, c]) => ({ length, ...c })).sort((a, b) => a.length - b.length);
}

const PAST_STOP = 1.01;

export interface RiskReport {
  withStop: number;
  stopShare: number | null;
  avgRisk: number | null;
  avgPlannedR: number | null;
  avgActualR: number | null;
  /** Lost more than the stop allowed for, before costs. The cost is how much more. */
  beyondPlan: { count: number; cost: number };
}

export function riskReport(trades: Trade[]): RiskReport {
  const closed = trades.filter(isClosed);
  const stopped = closed.filter((t) => t.rMultiple !== null);
  const risks = stopped.flatMap((t) => (t.riskAmount === null ? [] : [t.riskAmount]));
  const planned = closed.flatMap((t) => (t.plannedR === null ? [] : [t.plannedR]));
  // Before costs, or every loss at its stop would count once commission took it just under -1R. The 1% is rounding.
  const past = stopped.filter((t) => t.grossPnl !== null && t.riskAmount ? t.grossPnl / t.riskAmount < -PAST_STOP : false);
  return {
    withStop: stopped.length,
    stopShare: closed.length ? stopped.length / closed.length : null,
    avgRisk: risks.length ? round(risks.reduce((a, b) => a + b, 0) / risks.length, 2) : null,
    avgPlannedR: planned.length ? round(planned.reduce((a, b) => a + b, 0) / planned.length, 2) : null,
    avgActualR: stopped.length ? round(stopped.reduce((a, t) => a + (t.rMultiple as number), 0) / stopped.length, 2) : null,
    beyondPlan: { count: past.length, cost: addMoney(past.map((t) => -((t.grossPnl as number) + (t.riskAmount as number)))) },
  };
}

export type CompareKind = "money" | "percent" | "ratio" | "r" | "minutes" | "count";

export interface CompareRow {
  key: string;
  label: string;
  kind: CompareKind;
  a: number | null;
  b: number | null;
  /** A minus B. Blank when either side is. */
  diff: number | null;
}

const COMPARE: [keyof Metrics, string, CompareKind][] = [
  ["netPnl", "Net P&L", "money"],
  ["closedTrades", "Closed trades", "count"],
  ["winRate", "Win rate", "percent"],
  ["profitFactor", "Profit factor", "ratio"],
  ["expectancy", "Expectancy", "money"],
  ["avgWin", "Average win", "money"],
  ["avgLoss", "Average loss", "money"],
  ["payoffRatio", "Payoff ratio", "ratio"],
  ["avgR", "Average R", "r"],
  ["maxDrawdown", "Max drawdown", "money"],
  ["recoveryFactor", "Recovery factor", "ratio"],
  ["dayWinRate", "Winning days", "percent"],
  ["avgHoldMin", "Average hold", "minutes"],
  ["maxConsecutiveLosses", "Longest losing run", "count"],
  ["totalFees", "Total fees", "money"],
];

export function compareMetrics(a: Metrics, b: Metrics): CompareRow[] {
  return COMPARE.map(([key, label, kind]) => {
    const [x, y] = [a[key] as number | null, b[key] as number | null];
    return { key, label, kind, a: x, b: y, diff: x === null || y === null ? null : Math.round((x - y) * 1e8) / 1e8 };
  });
}

// ---------- excursions and replay ----------

/** One bar's range. */
export interface PriceRange {
  high: number;
  low: number;
}

/**
 * How far price went for and against a position while it was open, as distances from the entry, never below zero.
 * Bars can't say what came first inside themselves, so the entry bar's range may hold moves from before the entry.
 */
export function excursions(side: "long" | "short", entry: number, bars: PriceRange[]): { mae: number; mfe: number } | null {
  if (bars.length === 0) return null;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const [up, down] = [Math.max(0, high - entry), Math.max(0, entry - low)];
  return side === "long" ? { mae: round(down, 8), mfe: round(up, 8) } : { mae: round(up, 8), mfe: round(down, 8) };
}

export interface ExcursionStats {
  /** Closed trades with both a reading and a stop. */
  sample: number;
  avgMaeR: number | null;
  avgMfeR: number | null;
  /** Winners only: what they had at their best beyond what they kept. */
  leftBehindR: number | null;
}

export function excursionStats(trades: Trade[]): ExcursionStats {
  const usable = trades.filter(isClosed).filter((t) => t.mae !== null && t.mfe !== null && t.stopPrice !== null && t.entryPrice !== t.stopPrice);
  const dist = (t: Trade) => Math.abs(t.entryPrice - (t.stopPrice as number));
  const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null);
  const exitR = (t: Trade) => ((t.side === "long" ? 1 : -1) * ((t.exitPrice as number) - t.entryPrice)) / dist(t);
  return {
    sample: usable.length,
    avgMaeR: mean(usable.map((t) => (t.mae as number) / dist(t))),
    avgMfeR: mean(usable.map((t) => (t.mfe as number) / dist(t))),
    leftBehindR: mean(usable.filter((t) => t.pnl > 0).map((t) => Math.max(0, (t.mfe as number) / dist(t) - exitR(t)))),
  };
}

export interface ReplayFill {
  role: "entry" | "exit";
  price: number;
  quantity: number;
  /** Epoch seconds. */
  at: number;
}

export interface ReplayPosition {
  side: "long" | "short";
  /** Money per one point of price: size aside, the contract's multiplier and any conversion. */
  perPoint: number;
  fills: ReplayFill[];
}

/**
 * Where a set of positions stood at a moment, from their fills up to then and a price for what's still open.
 * Before costs. Once everything has closed, realized is the trades' gross result.
 */
export function replayPnl(positions: ReplayPosition[], at: number, price: number): { realized: number; open: number; size: number } {
  let [realized, open, size] = [0, 0, 0];
  for (const p of positions) {
    const dir = p.side === "long" ? 1 : -1;
    let [held, avg] = [0, 0];
    for (const f of p.fills.filter((x) => x.at <= at).sort((a, b) => a.at - b.at || (a.role === "entry" ? -1 : 1))) {
      if (f.role === "entry") {
        avg = (avg * held + f.price * f.quantity) / (held + f.quantity);
        held += f.quantity;
      } else {
        realized += dir * (f.price - avg) * f.quantity * p.perPoint;
        held -= f.quantity;
      }
    }
    if (held > 1e-9) {
      open += dir * (price - avg) * held * p.perPoint;
      size += dir * held;
    }
  }
  return { realized: round(realized, 2), open: round(open, 2), size: round(size, 8) };
}

/** The bar size that shows a span of time well without asking for too many. Seconds. */
export function timeframeFor(spanSeconds: number): "M1" | "M5" | "M15" | "H1" {
  if (spanSeconds <= 8 * 3600) return "M1";
  if (spanSeconds <= 3 * 86400) return "M5";
  if (spanSeconds <= 15 * 86400) return "M15";
  return "H1";
}
