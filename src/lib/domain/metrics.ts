import type { Account, Trade } from "./types";
import { round } from "./trade-math";
import { addMoney } from "./engine/position";
import { computeStats } from "./engine/stats";

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

export function computeMetrics(trades: Trade[]): Metrics {
  const closed = trades.filter(isClosed).sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const s = computeStats(closed.map((t) => t.pnl));
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);
  const withR = closed.filter((t) => t.rMultiple !== null);
  const planAnswered = trades.filter((t) => t.followedPlan !== null);
  const holds = closed.map((t) => holdMinutes(t) as number);
  const byPnl = [...closed].sort((a, b) => b.pnl - a.pnl);
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
  };
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
export function periodKey(iso: string, period: Period): string {
  const day = localDateKey(iso);
  if (period === "day") return day;
  if (period === "month") return day.slice(0, 7);
  if (period === "year") return day.slice(0, 4);
  const d = new Date(iso);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return localDateKey(monday.toISOString());
}

export interface PeriodRow {
  key: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export function periodSummaries(trades: Trade[], period: Period): PeriodRow[] {
  const rows = new Map<string, PeriodRow>();
  for (const t of trades.filter(isClosed)) {
    const key = periodKey(t.closedAt, period);
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

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Groups closed trades by the local calendar day they closed. */
export function dailySummaries(trades: Trade[]): Map<string, DaySummary> {
  const days = new Map<string, DaySummary>();
  for (const t of trades.filter(isClosed)) {
    const key = localDateKey(t.closedAt);
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
  return [...groups.entries()]
    .map(([key, ts]) => ({
      key,
      trades: ts.length,
      netPnl: addMoney(ts.map((t) => t.pnl as number)),
      winRate: ts.filter((t) => (t.pnl as number) > 0).length / ts.length,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

