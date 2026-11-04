import { abs, dec, div, sum, toNumber, ZERO, type Dec } from "./decimal";

/**
 * Statistics over closed trades' net P&L, in closing order.
 * Breakeven trades count as closed trades (they lower the win rate) but are neither wins nor
 * losses, and they end a streak. A value with nothing to measure is null, never zero.
 */
export interface Stats {
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxDrawdown: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
}

export function computeStats(netPnls: number[]): Stats {
  const values: Dec[] = netPnls.map(dec);
  const winners = values.filter((v) => v > ZERO);
  const losers = values.filter((v) => v < ZERO);
  const [grossProfit, grossLoss, net] = [sum(winners), sum(losers), sum(values)];

  let [peak, equity, drawdown] = [ZERO, ZERO, ZERO];
  let [winRun, lossRun, maxWins, maxLosses] = [0, 0, 0, 0];
  for (const v of values) {
    equity += v;
    if (equity > peak) peak = equity;
    if (peak - equity > drawdown) drawdown = peak - equity;
    winRun = v > ZERO ? winRun + 1 : 0;
    lossRun = v < ZERO ? lossRun + 1 : 0;
    maxWins = Math.max(maxWins, winRun);
    maxLosses = Math.max(maxLosses, lossRun);
  }

  const n = values.length;
  const ratio = (a: Dec, count: number) => (count ? toNumber(div(a, dec(count))) : null);
  return {
    closed: n,
    wins: winners.length,
    losses: losers.length,
    breakeven: n - winners.length - losers.length,
    winRate: n ? toNumber(div(dec(winners.length * 100), dec(n))) : null,
    netPnl: toNumber(net),
    grossProfit: toNumber(grossProfit),
    grossLoss: toNumber(grossLoss),
    profitFactor: losers.length ? toNumber(div(grossProfit, abs(grossLoss))) : null,
    expectancy: ratio(net, n),
    avgWin: ratio(grossProfit, winners.length),
    avgLoss: ratio(grossLoss, losers.length),
    maxDrawdown: toNumber(drawdown),
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
  };
}
