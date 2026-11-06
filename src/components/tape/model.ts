import { displayZone } from "@/lib/client/format";
import { zoneDateKey } from "@/lib/domain/zone";

/** The Tape's arithmetic: no React, no invented figures. Everything derives from the analytics equity and drawdown curves. */

export interface TapePoint {
  tradeId: number;
  iso: string;
  ms: number;
  equity: number;
  /** This trade's net P&L: the step in equity it caused. */
  net: number;
  drawdown: number;
}

export function buildPoints(equity: { tradeId: number; at: string; equity: number }[], drawdown: { drawdown: number }[]): TapePoint[] {
  return equity.map((p, i) => ({
    tradeId: p.tradeId,
    iso: p.at,
    ms: Date.parse(p.at),
    equity: p.equity,
    net: Math.round((p.equity - (i ? equity[i - 1].equity : 0)) * 1e8) / 1e8,
    drawdown: drawdown[i]?.drawdown ?? 0,
  }));
}

/** X of each trade on a time axis. One trade sits centred; trades sharing one instant spread by order so each stays reachable. */
export function xPositions(points: TapePoint[], left: number, width: number): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [left + width / 2];
  const span = points[n - 1].ms - points[0].ms;
  return points.map((p, i) => left + (span > 0 ? (p.ms - points[0].ms) / span : i / (n - 1)) * width);
}

/** Index of the x nearest to px. xs is ascending. Reads every trade, never the drawn columns. */
export function nearestIndex(xs: number[], px: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < px) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && px - xs[lo - 1] <= xs[lo] - px ? lo - 1 : lo;
}

export interface TickColumn {
  x: number;
  win: number;
  loss: number;
  flat: boolean;
}

/** Drawing only: one column per step of pixels, holding its largest win and largest loss. */
export function tickColumns(points: TapePoint[], xs: number[], step: number): TickColumn[] {
  const columns = new Map<number, TickColumn>();
  points.forEach((p, i) => {
    const key = Math.floor(xs[i] / step);
    const c = columns.get(key) ?? { x: key * step, win: 0, loss: 0, flat: false };
    if (p.net > 0) c.win = Math.max(c.win, p.net);
    else if (p.net < 0) c.loss = Math.max(c.loss, -p.net);
    else c.flat = true;
    columns.set(key, c);
  });
  return [...columns.values()];
}

/** The calendar day in the display zone, the unit the shared date filter speaks. */
export function localDay(ms: number): string {
  return zoneDateKey(ms, displayZone());
}

export interface Brushed {
  first: number;
  last: number;
  from: string;
  to: string;
  count: number;
  net: number;
}

/** The trades between two pixels and the days they span, or null when the stretch holds no trade. */
export function brushRange(points: TapePoint[], xs: number[], a: number, b: number): Brushed | null {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let first = -1;
  let last = -1;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < lo || xs[i] > hi) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  return {
    first,
    last,
    from: localDay(points[first].ms),
    to: localDay(points[last].ms),
    count: last - first + 1,
    net: Math.round((points[last].equity - (first ? points[first - 1].equity : 0)) * 1e8) / 1e8,
  };
}
