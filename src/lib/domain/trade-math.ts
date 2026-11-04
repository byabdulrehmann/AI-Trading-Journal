import type { TradeData } from "./types";

type Priced = Pick<
  TradeData,
  "side" | "entryPrice" | "exitPrice" | "quantity" | "multiplier" | "stopPrice" | "targetPrice" | "fees"
>;

const direction = (side: "long" | "short") => (side === "long" ? 1 : -1);

/** Net P&L = (exit − entry) × direction × size × multiplier − fees. */
export function computePnl(t: Priced): number | null {
  if (t.exitPrice === null) return null;
  const gross = (t.exitPrice - t.entryPrice) * direction(t.side) * t.quantity * t.multiplier;
  return round(gross - t.fees);
}

/** Planned risk in money = |entry − stop| × size × multiplier. */
export function plannedRisk(t: Priced): number | null {
  if (t.stopPrice === null) return null;
  const risk = Math.abs(t.entryPrice - t.stopPrice) * t.quantity * t.multiplier;
  return risk > 0 ? risk : null;
}

/** R multiple = net P&L ÷ planned risk. */
export function computeR(t: Priced): number | null {
  const pnl = computePnl(t);
  const risk = plannedRisk(t);
  if (pnl === null || risk === null) return null;
  return round(pnl / risk, 2);
}

/** Planned reward:risk = |target − entry| ÷ |entry − stop|. */
export function computePlannedR(t: Priced): number | null {
  if (t.stopPrice === null || t.targetPrice === null) return null;
  const risk = Math.abs(t.entryPrice - t.stopPrice);
  if (risk === 0) return null;
  return round(Math.abs(t.targetPrice - t.entryPrice) / risk, 2);
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
