import { computeMetrics, isClosed } from "./metrics";
import type { Trade } from "./types";

/** What a week or month held, from the record alone. Every line here is a count or a sum, never a guess. */
export interface ReviewFacts {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  avgR: number | null;
  rSample: number;
  tradingDays: number;
  winningDays: number;
  losingDays: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  best: { id: number; symbol: string; pnl: number } | null;
  worst: { id: number; symbol: string; pnl: number } | null;
  planAdherence: number | null;
  planSample: number;
  symbols: { symbol: string; trades: number; pnl: number }[];
  mistakes: { mistake: string; trades: number }[];
  previous: { closedTrades: number; netPnl: number; winRate: number | null };
}

const brief = (t: Trade | null) => (t && t.pnl !== null ? { id: t.id, symbol: t.symbol, pnl: t.pnl } : null);

export function reviewFacts(trades: Trade[], previous: Trade[], tz?: string): ReviewFacts {
  const m = computeMetrics(trades, tz);
  const p = computeMetrics(previous, tz);
  const closed = trades.filter(isClosed);
  const bySymbol = new Map<string, { trades: number; pnl: number }>();
  const byMistake = new Map<string, number>();
  for (const t of closed) {
    const s = bySymbol.get(t.symbol) ?? { trades: 0, pnl: 0 };
    bySymbol.set(t.symbol, { trades: s.trades + 1, pnl: s.pnl + t.pnl });
    for (const x of t.mistakes) byMistake.set(x, (byMistake.get(x) ?? 0) + 1);
  }
  return {
    closedTrades: m.closedTrades,
    wins: m.wins,
    losses: m.losses,
    winRate: m.winRate,
    netPnl: m.netPnl,
    avgR: m.avgR,
    rSample: m.rSample,
    tradingDays: m.tradingDays,
    winningDays: m.winningDays,
    losingDays: m.losingDays,
    bestDay: m.bestDay,
    worstDay: m.worstDay,
    best: brief(m.bestTrade),
    worst: brief(m.worstTrade),
    planAdherence: m.planAdherence,
    planSample: m.planSample,
    symbols: [...bySymbol].map(([symbol, s]) => ({ symbol, ...s })).sort((a, b) => b.trades - a.trades || b.pnl - a.pnl).slice(0, 3),
    mistakes: [...byMistake].map(([mistake, n]) => ({ mistake, trades: n })).sort((a, b) => b.trades - a.trades).slice(0, 3),
    previous: { closedTrades: p.closedTrades, netPnl: p.netPnl, winRate: p.winRate },
  };
}
