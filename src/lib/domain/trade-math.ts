import { computePosition, type PositionInput } from "./engine/position";
import type { TradeData } from "./types";

/** Quick figures for a form preview or a row, through the same engine as everything else. */
type Priced = Pick<TradeData, "side" | "entryPrice" | "exitPrice" | "quantity" | "multiplier" | "stopPrice" | "targetPrice" | "commission" | "swap" | "otherFees">;

const asPosition = (t: Priced & { fxRate?: number | null }): PositionInput => ({
  side: t.side,
  symbol: "",
  accountCurrency: "",
  contractSize: t.multiplier,
  fxRate: t.fxRate ?? 1,
  entries: [{ price: t.entryPrice, qty: t.quantity }],
  exits: t.exitPrice === null ? [] : [{ price: t.exitPrice, qty: t.quantity }],
  commission: t.commission,
  swap: t.swap,
  otherFees: t.otherFees,
  stopPrice: t.stopPrice,
  targetPrice: t.targetPrice,
});

/** Net P&L = gross − commission − swap − other fees. */
export const computePnl = (t: Priced): number | null => computePosition(asPosition(t)).netPnl;

/** Planned risk in money = |entry − stop| × size × multiplier. */
export const plannedRisk = (t: Priced): number | null => computePosition(asPosition(t)).initialRisk;

/** R multiple = net P&L ÷ planned risk. */
export const computeR = (t: Priced): number | null => computePosition(asPosition(t)).rMultiple;

/** Planned reward:risk = |target − entry| ÷ |entry − stop|. */
export const computePlannedR = (t: Priced): number | null => computePosition(asPosition(t)).plannedR;

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
