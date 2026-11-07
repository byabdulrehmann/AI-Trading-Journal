import "server-only";
import { TIMEFRAME_SECONDS, simulatedBars, type Bar, type BarMarker, type BarSource, type Timeframe } from "@/lib/domain/bars";
import { excursions, timeframeFor, type ReplayPosition } from "@/lib/domain/metrics";
import type { Trade } from "@/lib/domain/types";
import { db } from "./db";
import { barsFor } from "./mt5/bars";

export interface TradeBars {
  source: BarSource | null;
  /** Why there are no bars, when there aren't. */
  reason: string | null;
  timeframe: Timeframe;
  bars: Bar[];
  markers: BarMarker[];
  positions: ReplayPosition[];
}

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const MIN_PAD = 30 * 60;
const MAX_PAD = 12 * 3600;
export const MAX_SPAN_SECONDS = 60 * 86400;

function markersOf(t: Trade): BarMarker[] {
  return (t.executions ?? []).map((e) => ({ t: seconds(e.executedAt), role: e.role, side: t.side, price: e.price, quantity: e.quantity, tradeId: t.id }));
}

function positionOf(t: Trade): ReplayPosition {
  return { side: t.side, perPoint: t.multiplier * (t.fxRate ?? 1), fills: (t.executions ?? []).map((e) => ({ role: e.role, price: e.price, quantity: e.quantity, at: seconds(e.executedAt) })) };
}

/** Sample trades get made-up prices, labelled as such. Everything else gets the broker's or none: nothing is ever invented for a real trade. */
async function barsForRange(userId: number, trades: Trade[], symbol: string, from: number, to: number, seed: number): Promise<Pick<TradeBars, "source" | "reason" | "timeframe" | "bars">> {
  const timeframe = timeframeFor(to - from);
  if (trades.length && trades.every((t) => t.source === "sample")) {
    const anchors = trades.flatMap((t) => (t.executions ?? []).map((e) => ({ t: seconds(e.executedAt), price: e.price })));
    return { source: "simulated", reason: null, timeframe, bars: simulatedBars(anchors, from, to, TIMEFRAME_SECONDS[timeframe], seed) };
  }
  const answer = await barsFor(userId, symbol, timeframe, from, to, trades[0]?.accountId);
  return answer.ok ? { source: "mt5", reason: null, timeframe, bars: answer.bars } : { source: null, reason: answer.reason, timeframe, bars: [] };
}

/** One trade's chart, and its MAE and MFE saved the first time prices are found for it. */
export async function tradeBars(userId: number, t: Trade): Promise<TradeBars> {
  const open = seconds(t.openedAt);
  const close = t.closedAt ? seconds(t.closedAt) : Math.floor(Date.now() / 1000);
  const pad = Math.min(MAX_PAD, Math.max(MIN_PAD, Math.round((close - open) * 0.5)));
  const span = Math.min(MAX_SPAN_SECONDS, close - open + pad * 2);
  const from = open - pad;
  const to = from + span;
  const r = await barsForRange(userId, [t], t.symbol, from, to, t.id);
  if (t.status === "closed" && t.mae === null && r.bars.length) saveExcursion(t, r.bars, open, close, TIMEFRAME_SECONDS[r.timeframe]);
  return { ...r, markers: markersOf(t), positions: [positionOf(t)] };
}

function saveExcursion(t: Trade, bars: Bar[], open: number, close: number, step: number) {
  const held = bars.filter((b) => b.t + step > open && b.t <= close).map((b) => ({ high: b.h, low: b.l }));
  const e = excursions(t.side, t.entryPrice, held);
  if (e) db().prepare("UPDATE trades SET mae = ?, mfe = ?, excursion_note = ? WHERE id = ?").run(e.mae, e.mfe, `${step / 60}m bars`, t.id);
}

/** All of a day's trades in one instrument. */
export async function dayBars(userId: number, trades: Trade[], symbol: string): Promise<TradeBars & { from: number; to: number }> {
  const inSymbol = trades.filter((t) => t.symbol === symbol);
  const times = inSymbol.flatMap((t) => (t.executions ?? []).map((e) => seconds(e.executedAt)));
  const from = Math.min(...times) - MIN_PAD;
  const to = Math.max(...times) + MIN_PAD;
  const r = await barsForRange(userId, inSymbol, symbol, from, to, inSymbol[0]?.id ?? 1);
  return { ...r, from, to, markers: inSymbol.flatMap(markersOf), positions: inSymbol.map(positionOf) };
}
