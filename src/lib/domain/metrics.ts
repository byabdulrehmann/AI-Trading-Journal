import type { Account, Trade } from "./types";
import { round } from "./trade-math";

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
    formula: "Σ (exit − entry) × direction × size × multiplier − fees",
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
    meaning: "Above 1 means winners earned more than losers cost. Shown as ∞ when there are no losses.",
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
    label: "Median hold — winners",
    formula: "median(close − open) of winners",
    meaning: "Typical time a winning trade stays open.",
  },
  holdLosers: {
    label: "Median hold — losers",
    formula: "median(close − open) of losers",
    meaning: "Typical time a losing trade stays open.",
  },
} satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export interface Metrics {
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
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
  t.pnl !== null && t.closedAt !== null;

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
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);
  const grossProfit = sum(winners.map((t) => t.pnl));
  const grossLoss = sum(losers.map((t) => t.pnl));
  const netPnl = sum(closed.map((t) => t.pnl));
  const withR = closed.filter((t) => t.rMultiple !== null);
  const planAnswered = trades.filter((t) => t.followedPlan !== null);

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const t of closed) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const byPnl = [...closed].sort((a, b) => b.pnl - a.pnl);
  return {
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins: winners.length,
    losses: losers.length,
    netPnl: round(netPnl),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    winRate: closed.length ? winners.length / closed.length : null,
    profitFactor: losers.length ? round(grossProfit / Math.abs(grossLoss), 2) : winners.length ? Infinity : null,
    expectancy: closed.length ? round(netPnl / closed.length) : null,
    avgR: withR.length ? round(sum(withR.map((t) => t.rMultiple as number)) / withR.length, 2) : null,
    rSample: withR.length,
    maxDrawdown: round(maxDrawdown),
    planAdherence: planAnswered.length
      ? planAnswered.filter((t) => t.followedPlan).length / planAnswered.length
      : null,
    planSample: planAnswered.length,
    avgWin: winners.length ? round(grossProfit / winners.length) : null,
    avgLoss: losers.length ? round(grossLoss / losers.length) : null,
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
      equity = round(equity + t.pnl);
      return { tradeId: t.id, at: t.closedAt, equity };
    });
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
    d.pnl = round(d.pnl + t.pnl);
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
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([key, ts]) => ({
      key,
      trades: ts.length,
      netPnl: round(sum(ts.map((t) => t.pnl as number))),
      winRate: ts.filter((t) => (t.pnl as number) > 0).length / ts.length,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
