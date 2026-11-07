import type { Bar } from "./bars";

/** A backtest's hard limit, so one session can't ask the broker for years of one-minute bars. */
export const MAX_SESSION_BARS = 5000;
/** Bars shown before the session's start, so the first decision has a chart to read. */
export const WARMUP_BARS = 100;

export interface SimPosition {
  side: "long" | "short";
  entry: number;
  stop: number | null;
  target: number | null;
  /** Epoch seconds of the fill. Only bars starting after it can reach the stop or target. */
  openedAt: number;
}

export interface SimExit {
  /** The start of the bar that reached the level: when inside the bar isn't known. */
  t: number;
  price: number;
  reason: "stop" | "target";
  /** Both levels were inside one bar. The stop is assumed first, the cautious reading. */
  bothInBar: boolean;
}

/**
 * The first bar after the fill, up to `until`, that reaches the stop or the target. A bar that opens past a level fills
 * at its open, so a gap through the stop costs more than the stop. Bars are the broker's bid, and the spread isn't added.
 */
export function resolveExit(p: SimPosition, bars: Bar[], until: number): SimExit | null {
  const long = p.side === "long";
  for (const b of bars) {
    if (b.t <= p.openedAt || b.t > until) continue;
    const stopHit = p.stop !== null && (long ? b.l <= p.stop : b.h >= p.stop);
    const targetHit = p.target !== null && (long ? b.h >= p.target : b.l <= p.target);
    if (!stopHit && !targetHit) continue;
    const gapStop = p.stop !== null && (long ? b.o <= p.stop : b.o >= p.stop);
    const gapTarget = p.target !== null && (long ? b.o >= p.target : b.o <= p.target);
    if (gapStop) return { t: b.t, price: b.o, reason: "stop", bothInBar: false };
    if (gapTarget) return { t: b.t, price: b.o, reason: "target", bothInBar: false };
    if (stopHit) return { t: b.t, price: p.stop as number, reason: "stop", bothInBar: targetHit };
    return { t: b.t, price: p.target as number, reason: "target", bothInBar: false };
  }
  return null;
}

/** Why an order can't be placed at this price, or null when it can. */
export function orderProblem(side: "long" | "short", price: number, stop: number | null, target: number | null): string | null {
  const long = side === "long";
  if (stop !== null && (long ? stop >= price : stop <= price)) return `The stop must be ${long ? "below" : "above"} the entry price, ${price}.`;
  if (target !== null && (long ? target <= price : target >= price)) return `The target must be ${long ? "above" : "below"} the entry price, ${price}.`;
  return null;
}

/** Where the cursor lands after moving `count` bars forward, never past the last one. */
export function advance(bars: Bar[], cursor: number, count: number): number {
  const at = bars.findIndex((b) => b.t > cursor);
  if (at < 0) return cursor;
  return bars[Math.min(bars.length - 1, at + count - 1)].t;
}
