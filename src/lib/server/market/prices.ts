import "server-only";
import { seasonality, trend, type DailyClose, type Seasonality, type Trend } from "@/lib/domain/seasonal";
import { db } from "../db";
import { barsFor } from "../mt5/bars";

/**
 * Seasonality and trend per pair, from daily bars read (read-only) from the user's connected MT5 account. Reading
 * them signs the terminal in once per symbol, so it runs in the background and the page shows what's ready.
 */

const YEARS = 11;
const DAY = 86_400;

export interface PairPrices {
  symbol: string;
  /** The broker's own name for it, when it differs. */
  brokerSymbol: string;
  seasonality: Seasonality | null;
  trend: Trend;
  /** The newest daily close used, seconds. */
  asOf: number;
}

export interface Prices {
  /** "reading": daily bars are being fetched now; ask again shortly. */
  status: "none" | "reading" | "ready";
  pairs: PairPrices[];
  /** Why some or all pairs have no prices. */
  notice: string | null;
}

type UserState = { day: number; checked: number; complete: boolean; running: Promise<void> | null; closes: Map<string, { brokerSymbol: string; closes: DailyClose[] }>; notice: string | null };
const g = globalThis as unknown as { __jarvisPrices?: Map<number, UserState> };
g.__jarvisPrices ??= new Map();
const users = g.__jarvisPrices;

const today = () => Math.floor(Date.now() / 1000 / DAY);
const RETRY_MS = 15 * 60_000;

/**
 * The broker's name for a pair: an instrument this user's accounts already know with the same currencies
 * (EURUSD.m, EURUSDm), or the pair itself.
 * shortcut: only symbols the user has traded or synced are known, so an untraded suffixed symbol isn't found; read the broker's symbol list if that comes up.
 */
function brokerSymbol(userId: number, pair: string): string {
  const row = db()
    .prepare(
      `SELECT i.symbol FROM instruments i JOIN accounts a ON a.id = i.account_id
       WHERE a.user_id = ? AND (i.symbol = ? OR (i.base_currency = ? AND i.profit_currency = ?))
       ORDER BY i.symbol = ? DESC, length(i.symbol) LIMIT 1`,
    )
    .get(userId, pair, pair.slice(0, 3), pair.slice(3), pair) as { symbol: string } | undefined;
  return row?.symbol ?? pair;
}

/** Starts reading the daily bars for these pairs: once a day, or again after 15 minutes if some were missing. Never throws. */
export function refreshPrices(userId: number, pairs: string[]): void {
  const state = users.get(userId);
  if (state && (state.running || (state.day === today() && (state.complete || Date.now() - state.checked < RETRY_MS)))) return;
  const next: UserState = { day: today(), checked: Date.now(), complete: false, running: null, closes: state?.closes ?? new Map(), notice: null };
  users.set(userId, next);
  next.running = (async () => {
    // Up to yesterday's bar: finished, so the stored bars answer every later ask that day, even after a restart.
    const to = (today() - 1) * DAY;
    const from = to - YEARS * 365 * DAY;
    const missing: string[] = [];
    for (const pair of pairs) {
      const symbol = brokerSymbol(userId, pair);
      try {
        const res = await barsFor(userId, symbol, "D1", from, to);
        if (res.ok) next.closes.set(pair, { brokerSymbol: symbol, closes: res.bars.map((b) => ({ t: b.t, c: b.c })) });
        else {
          missing.push(pair);
          next.notice = res.reason;
        }
      } catch {
        missing.push(pair);
      }
    }
    if (missing.length && missing.length < pairs.length) next.notice = `No daily prices for ${missing.join(", ")}. ${next.notice ?? ""}`.trim();
    else if (missing.length && !next.notice) next.notice = "Couldn't read daily prices from MT5 just now.";
    next.complete = missing.length === 0;
    next.running = null;
  })();
}

/** What's been read so far. */
export function prices(userId: number): Prices {
  const state = users.get(userId);
  if (!state) return { status: "none", pairs: [], notice: null };
  const now = new Date();
  const pairs = [...state.closes].map(([symbol, v]) => ({
    symbol,
    brokerSymbol: v.brokerSymbol,
    seasonality: seasonality(v.closes, now),
    trend: trend(v.closes),
    asOf: v.closes.at(-1)?.t ?? 0,
  }));
  return { status: state.running ? "reading" : "ready", pairs, notice: state.notice };
}
