import "server-only";
import { z } from "zod";
import { MAX_SESSION_BARS, WARMUP_BARS, advance, orderProblem, resolveExit } from "@/lib/domain/backtest";
import { TIMEFRAME_SECONDS, simulatedBars, type Bar, type BarMarker, type Timeframe } from "@/lib/domain/bars";
import { excursions } from "@/lib/domain/metrics";
import { TradeInput, type Trade, type TradeData } from "@/lib/domain/types";
import { db, now, transaction } from "./db";
import { barsFor } from "./mt5/bars";
import { REFUSED_REASON, connectionsForPrices, loginRefused } from "./repo/mt5";
import { createAccount, createTrade, getAccount, getTrade, listInstruments, listTrades, saveBrokerInstrument, updateTrade } from "./repo/journal";
import { getSettings } from "./repo/settings";

export const SessionInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(60),
    symbol: z.string().trim().min(1, "Symbol is required").max(20).toUpperCase(),
    timeframe: z.enum(Object.keys(TIMEFRAME_SECONDS) as [Timeframe, ...Timeframe[]]),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    startingBalance: z.number().min(0, "Balance can't be negative").max(1e12),
    strategy: z.string().trim().max(60).default(""),
  })
  .superRefine((s, ctx) => {
    const [a, b] = [Date.parse(s.start), Date.parse(s.end)];
    if (b <= a) ctx.addIssue({ code: "custom", path: ["end"], message: "The end must be after the start." });
    if (b > Date.now()) ctx.addIssue({ code: "custom", path: ["end"], message: "A backtest runs on past prices, so the end can't be in the future." });
    const bars = (b - a) / 1000 / TIMEFRAME_SECONDS[s.timeframe];
    if (bars > MAX_SESSION_BARS) ctx.addIssue({ code: "custom", path: ["end"], message: `That's about ${Math.round(bars).toLocaleString("en-US")} bars. Keep a session under ${MAX_SESSION_BARS.toLocaleString("en-US")}: a shorter range or a longer timeframe.` });
  });

export const OrderInput = z.object({
  side: z.enum(["long", "short"]),
  quantity: z.number().positive("Size must be above 0").max(1e9),
  stopPrice: z.number().positive().nullable().default(null),
  targetPrice: z.number().positive().nullable().default(null),
  note: z.string().max(2000).default(""),
});

interface Row {
  id: number;
  account_id: number;
  price_account_id: number | null;
  symbol: string;
  timeframe: Timeframe;
  start_time: number;
  end_time: number;
  cursor_time: number;
  strategy: string;
  simulated: number;
  seed: number;
  anchor_price: number | null;
  is_sample: number;
  created_at: string;
  updated_at: string;
  name: string;
  currency: string;
  starting_balance: number;
}

export interface BacktestSession {
  id: number;
  accountId: number;
  name: string;
  symbol: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  cursor: string;
  currency: string;
  startingBalance: number;
  strategy: string;
  source: "mt5" | "simulated";
  isSample: boolean;
  updatedAt: string;
  trades: number;
  open: number;
  netPnl: number;
}

const SELECT = `SELECT s.*, a.name, a.currency, a.starting_balance FROM backtest_sessions s JOIN accounts a ON a.id = s.account_id`;
const iso = (t: number) => new Date(t * 1000).toISOString();
const seconds = (v: string) => Math.floor(Date.parse(v) / 1000);

function toSession(r: Row): BacktestSession {
  const c = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status != 'closed' THEN 1 ELSE 0 END), 0) AS open, COALESCE(SUM(CASE WHEN status = 'closed' AND pnl_status = 'ok' THEN net_pnl ELSE 0 END), 0) AS net FROM trades WHERE account_id = ? AND deleted_at IS NULL").get(r.account_id) as { n: number; open: number; net: number };
  return {
    id: r.id, accountId: r.account_id, name: r.name, symbol: r.symbol, timeframe: r.timeframe, start: iso(r.start_time), end: iso(r.end_time), cursor: iso(r.cursor_time),
    currency: r.currency, startingBalance: r.starting_balance, strategy: r.strategy, source: r.simulated ? "simulated" : "mt5", isSample: r.is_sample === 1, updatedAt: r.updated_at,
    trades: c.n, open: c.open, netPnl: c.net,
  };
}

const row = (userId: number, id: number) => db().prepare(`${SELECT} WHERE s.id = ? AND s.user_id = ?`).get(id, userId) as unknown as Row | undefined;

/** Sample sessions are hidden like other sample data, unless asked for. */
export function listSessions(userId: number, includeSample: boolean): BacktestSession[] {
  return (db().prepare(`${SELECT} WHERE s.user_id = ? ${includeSample ? "" : "AND s.is_sample = 0"} ORDER BY s.updated_at DESC`).all(userId) as unknown as Row[]).map(toSession);
}

export function getSession(userId: number, id: number): BacktestSession | null {
  const r = row(userId, id);
  return r ? toSession(r) : null;
}

/** Practice prices for the sample session only: a repeatable walk, always labelled as simulated. */
function practiceBars(r: Pick<Row, "start_time" | "end_time" | "timeframe" | "seed" | "anchor_price">): Bar[] {
  const step = TIMEFRAME_SECONDS[r.timeframe];
  const from = r.start_time - WARMUP_BARS * step;
  let s = r.seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const anchors: { t: number; price: number }[] = [];
  let price = r.anchor_price ?? 100;
  // Choppy enough that a simple breakout rule wins about half the time, as in real markets, not three times in four.
  for (let t = from; t <= r.end_time; t += step * 8) {
    anchors.push({ t, price });
    price *= 1 + (rand() - 0.5) * 0.003;
  }
  return simulatedBars(anchors, from, r.end_time, step, r.seed);
}

async function sessionBars(userId: number, r: Row): Promise<{ ok: true; bars: Bar[] } | { ok: false; reason: string }> {
  if (r.simulated) return { ok: true, bars: practiceBars(r) };
  const from = r.start_time - WARMUP_BARS * TIMEFRAME_SECONDS[r.timeframe];
  const answer = await barsFor(userId, r.symbol, r.timeframe, from, r.end_time, r.price_account_id ?? undefined);
  return answer.ok ? { ok: true, bars: answer.bars } : answer;
}

/** The last bar before the start, so the session opens on the warm-up and nothing after it. */
const startCursor = (bars: Bar[], start: number) => [...bars].reverse().find((b) => b.t < start)?.t ?? bars[0].t;

/**
 * A new session on the broker's past prices. Its trades go in an account of its own, so every report works on them,
 * and they stay out of live figures. Size, contract and currency come from the broker's spec for the symbol.
 */
export async function createSession(userId: number, input: z.output<typeof SessionInput>): Promise<{ ok: true; session: BacktestSession } | { ok: false; reason: string }> {
  const priceAccount = connectionsForPrices(userId)[0];
  if (!priceAccount && loginRefused(userId)) return { ok: false, reason: REFUSED_REASON };
  if (!priceAccount) return { ok: false, reason: "Backtesting runs on your broker's past prices, read from a connected MT5 account, and none is connected. Connect one under Accounts & MT5." };
  const step = TIMEFRAME_SECONDS[input.timeframe];
  const [start, end] = [seconds(input.start), seconds(input.end)];
  const answer = await barsFor(userId, input.symbol, input.timeframe, start - WARMUP_BARS * step, end, priceAccount);
  if (!answer.ok) return answer;
  if (!answer.bars.some((b) => b.t >= start)) return { ok: false, reason: `Your broker has no ${input.symbol} prices in that range.` };
  const source = getAccount(userId, answer.accountId);
  const spec = listInstruments(userId, answer.accountId).find((i) => i.symbol === input.symbol);
  const currency = spec?.profitCurrency ?? source?.currency ?? "USD";
  const id = transaction(db(), () => {
    const account = createAccount(userId, { name: input.name, broker: "Backtest", currency, startingBalance: input.startingBalance }, { source: "backtest" });
    if (spec) saveBrokerInstrument(account.id, spec);
    return Number(db()
      .prepare("INSERT INTO backtest_sessions (user_id, account_id, price_account_id, symbol, timeframe, start_time, end_time, cursor_time, strategy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(userId, account.id, answer.accountId, input.symbol, input.timeframe, start, end, startCursor(answer.bars, start), input.strategy, now(), now()).lastInsertRowid);
  });
  return { ok: true, session: getSession(userId, id)! };
}

/** The sample session: practice prices and trades made by the same engine, all marked as sample. It stops partway, so it can be carried on. */
export function createSampleSession(userId: number, today: Date): number {
  const step = TIMEFRAME_SECONDS.M15;
  const end = Math.floor(today.getTime() / 1000 / 86400) * 86400 - 2 * 86400;
  const start = end - 14 * 86400;
  const r = { start_time: start, end_time: end, timeframe: "M15" as const, seed: 99, anchor_price: 1.0842 };
  const bars = practiceBars(r);
  const account = createAccount(userId, { name: "Sample backtest: EURUSD breakouts", broker: "Backtest", currency: "USD", startingBalance: 10000 }, { isSample: true, source: "backtest" });
  const cursor = bars[Math.floor(bars.length * 0.7)].t;
  // A simple rule: after 20 bars, go with a 20-bar break, 1.5 average ranges of stop, 2R of target.
  const trades: TradeData[] = [];
  let busyUntil = 0;
  for (let i = WARMUP_BARS; i < bars.length - 1; i++) {
    const b = bars[i];
    if (b.t >= cursor) break;
    if (b.t < start || b.t <= busyUntil) continue;
    const back = bars.slice(i - 20, i);
    const high = Math.max(...back.map((x) => x.h));
    const low = Math.min(...back.map((x) => x.l));
    const side = b.c > high ? "long" : b.c < low ? "short" : null;
    if (!side) continue;
    const range = back.reduce((a, x) => a + x.h - x.l, 0) / back.length;
    const risk = Math.round(range * 1.5 * 1e5) / 1e5;
    const entry = b.c;
    const stop = Math.round((side === "long" ? entry - risk : entry + risk) * 1e5) / 1e5;
    const target = Math.round((side === "long" ? entry + 2 * risk : entry - 2 * risk) * 1e5) / 1e5;
    const openedAt = b.t + step - 1;
    const exit = resolveExit({ side, entry, stop, target, openedAt }, bars, cursor);
    if (!exit) break;
    busyUntil = exit.t;
    trades.push(TradeInput.parse({ accountId: account.id, symbol: "EURUSD", side, openedAt: iso(openedAt), closedAt: iso(exit.t), entryPrice: entry, exitPrice: exit.price, quantity: 100000, stopPrice: stop, targetPrice: target, strategy: "", exitReason: exit.reason === "stop" ? "Stop reached" : "Target reached", setup: "20-bar breakout" }));
  }
  const ids = trades.map((t) => createTrade(userId, t, { source: "backtest" }).id);
  for (const id of ids) saveExcursion(getTrade(userId, id)!, bars, step);
  return Number(db()
    .prepare("INSERT INTO backtest_sessions (user_id, account_id, symbol, timeframe, start_time, end_time, cursor_time, simulated, seed, anchor_price, is_sample, created_at, updated_at) VALUES (?, ?, 'EURUSD', 'M15', ?, ?, ?, 1, ?, ?, 1, ?, ?)")
    .run(userId, account.id, start, end, cursor, r.seed, r.anchor_price, now(), now()).lastInsertRowid);
}

function saveExcursion(t: Trade, bars: Bar[], step: number) {
  if (!t.closedAt) return;
  const [open, close] = [seconds(t.openedAt), seconds(t.closedAt)];
  const held = bars.filter((b) => b.t + step > open && b.t <= close).map((b) => ({ high: b.h, low: b.l }));
  const e = excursions(t.side, t.entryPrice, held);
  if (e) db().prepare("UPDATE trades SET mae = ?, mfe = ?, excursion_note = ? WHERE id = ?").run(e.mae, e.mfe, `${step / 60}m bars`, t.id);
}

function closeAt(userId: number, t: Trade, at: number, price: number, reason: string, bars: Bar[], step: number) {
  const closed = updateTrade(userId, t.id, { ...t, executions: null, closedAt: iso(at), exitPrice: price, exitReason: t.exitReason || reason });
  if (closed) saveExcursion(closed, bars, step);
}

export interface SessionView {
  session: BacktestSession;
  /** Up to the cursor only: the page never receives a price it hasn't reached. */
  bars: Bar[];
  markers: BarMarker[];
  trades: Trade[];
  atEnd: boolean;
  reason: string | null;
}

export async function sessionView(userId: number, id: number): Promise<SessionView | null> {
  const r = row(userId, id);
  if (!r) return null;
  const answer = await sessionBars(userId, r);
  const trades = listTrades(userId, { accountId: r.account_id });
  const bars = answer.ok ? answer.bars.filter((b) => b.t <= r.cursor_time) : [];
  const markers = trades.flatMap((t) => (t.executions ?? []).filter((e) => seconds(e.executedAt) <= r.cursor_time + TIMEFRAME_SECONDS[r.timeframe]).map((e) => ({ t: seconds(e.executedAt), role: e.role, side: t.side, price: e.price, quantity: e.quantity, tradeId: t.id })));
  return { session: toSession(r), bars, markers, trades, atEnd: answer.ok ? r.cursor_time >= answer.bars.at(-1)!.t : false, reason: answer.ok ? null : answer.reason };
}

type Outcome = { ok: true } | { ok: false; reason: string; status?: number };

/** Moves forward, closing anything whose stop or target the new bars reach. */
export async function stepSession(userId: number, id: number, count: number): Promise<Outcome> {
  const r = row(userId, id);
  if (!r) return { ok: false, reason: "Session not found.", status: 404 };
  const answer = await sessionBars(userId, r);
  if (!answer.ok) return answer;
  const step = TIMEFRAME_SECONDS[r.timeframe];
  const to = advance(answer.bars, r.cursor_time, count);
  // Each close is its own transaction. Stopped halfway, the next step finds the rest again: nothing closes twice.
  for (const t of listTrades(userId, { accountId: r.account_id }).filter((x) => x.status !== "closed")) {
    const exit = resolveExit({ side: t.side, entry: t.entryPrice, stop: t.stopPrice, target: t.targetPrice, openedAt: seconds(t.openedAt) }, answer.bars, to);
    if (exit) closeAt(userId, t, exit.t, exit.price, exit.reason === "stop" ? (exit.bothInBar ? "Stop reached (stop and target in one bar: stop assumed first)" : "Stop reached") : "Target reached", answer.bars, step);
  }
  db().prepare("UPDATE backtest_sessions SET cursor_time = ?, updated_at = ? WHERE id = ?").run(to, now(), id);
  return { ok: true };
}

/** Fills at the close of the bar the session is on, the last price it has seen. */
export async function placeOrder(userId: number, id: number, o: z.output<typeof OrderInput>): Promise<Outcome & { tradeId?: number }> {
  const r = row(userId, id);
  if (!r) return { ok: false, reason: "Session not found.", status: 404 };
  const answer = await sessionBars(userId, r);
  if (!answer.ok) return answer;
  const bar = answer.bars.find((b) => b.t === r.cursor_time);
  if (!bar) return { ok: false, reason: "The session's current bar isn't in the prices any more." };
  if (r.cursor_time >= answer.bars.at(-1)!.t) return { ok: false, reason: "The session has reached its end, so no new trades can open." };
  const problem = orderProblem(o.side, bar.c, o.stopPrice, o.targetPrice);
  if (problem) return { ok: false, reason: problem, status: 422 };
  const spec = listInstruments(userId, r.account_id).find((i) => i.symbol === r.symbol);
  const fees = getSettings(userId).feeDefaults;
  const t = createTrade(userId, TradeInput.parse({
    accountId: r.account_id, symbol: r.symbol, side: o.side, openedAt: iso(r.cursor_time + TIMEFRAME_SECONDS[r.timeframe] - 1), entryPrice: bar.c, quantity: o.quantity,
    multiplier: spec?.contractSize ?? 1, stopPrice: o.stopPrice, targetPrice: o.targetPrice, commission: fees.commission, otherFees: fees.otherFees, strategy: r.strategy, entryReason: o.note,
  }), { source: "backtest" });
  db().prepare("UPDATE backtest_sessions SET updated_at = ? WHERE id = ?").run(now(), id);
  return { ok: true, tradeId: t.id };
}

export async function closePosition(userId: number, id: number, tradeId: number): Promise<Outcome> {
  const r = row(userId, id);
  if (!r) return { ok: false, reason: "Session not found.", status: 404 };
  const t = getTrade(userId, tradeId);
  if (!t || t.accountId !== r.account_id) return { ok: false, reason: "That trade isn't in this session.", status: 404 };
  if (t.status === "closed") return { ok: false, reason: "That trade is already closed.", status: 409 };
  const answer = await sessionBars(userId, r);
  if (!answer.ok) return answer;
  const bar = answer.bars.find((b) => b.t === r.cursor_time);
  if (!bar) return { ok: false, reason: "The session's current bar isn't in the prices any more." };
  const step = TIMEFRAME_SECONDS[r.timeframe];
  closeAt(userId, t, r.cursor_time + step - 1, bar.c, "Closed by hand", answer.bars, step);
  return { ok: true };
}

/** The session, its account and its trades. Files attached to its trades go too. */
export function deleteSession(userId: number, id: number): string[] | null {
  const r = row(userId, id);
  if (!r) return null;
  const files = (db().prepare("SELECT a.stored_name FROM attachments a JOIN trades t ON t.id = a.trade_id WHERE t.account_id = ?").all(r.account_id) as { stored_name: string }[]).map((f) => f.stored_name);
  db().prepare("DELETE FROM accounts WHERE id = ? AND user_id = ?").run(r.account_id, userId);
  return files;
}

/** The session a backtest trade belongs to, for its price chart. */
export async function barsForBacktestTrade(userId: number, t: Trade): Promise<{ bars: Bar[]; simulated: boolean; timeframe: Timeframe } | null> {
  const r = db().prepare(`${SELECT} WHERE s.account_id = ? AND s.user_id = ?`).get(t.accountId, userId) as Row | undefined;
  if (!r) return null;
  const answer = await sessionBars(userId, r);
  return answer.ok ? { bars: answer.bars.filter((b) => b.t <= r.cursor_time), simulated: r.simulated === 1, timeframe: r.timeframe } : null;
}
