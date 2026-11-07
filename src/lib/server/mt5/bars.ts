import "server-only";
import { db, transaction } from "../db";
import { brokerOffset, connectionsForPrices, readForSync } from "../repo/mt5";
import { TIMEFRAME_SECONDS, type Bar, type Timeframe } from "@/lib/domain/bars";
import { fetchBars } from "./client";
import { decrypt } from "./crypto";

export type BarsAnswer = { ok: true; bars: Bar[]; accountId: number } | { ok: false; reason: string };

const NO_CONNECTION = "No price data: Jarvis reads prices from a connected MT5 account, and none is connected right now.";

function reasonFor(category: string, symbol: string): string {
  if (category === "no_symbol") return `Your MT5 broker doesn't list ${symbol}, so there's no price data for it.`;
  if (category === "wrong_password") return "MT5 refused the login just now, so prices couldn't be read. Check the connection under Accounts & MT5.";
  if (category === "terminal_missing") return "The dedicated MT5 terminal isn't set up, so prices can't be read.";
  return "Couldn't read prices from MT5 just now. Try again in a moment.";
}

const readStored = (accountId: number, symbol: string, tf: Timeframe, from: number, to: number): Bar[] =>
  (db().prepare("SELECT time, open, high, low, close FROM market_bars WHERE account_id = ? AND symbol = ? AND timeframe = ? AND time >= ? AND time <= ? ORDER BY time").all(accountId, symbol, tf, from, to) as { time: number; open: number; high: number; low: number; close: number }[])
    .map((r) => ({ t: r.time, o: r.open, h: r.high, l: r.low, c: r.close }));

/** A fetch covers a range only for bars already finished when it ran, so the latest ones are asked for again. */
const alreadyFetched = (accountId: number, symbol: string, tf: Timeframe, from: number, to: number) =>
  Boolean(db().prepare("SELECT 1 FROM bar_fetches WHERE account_id = ? AND symbol = ? AND timeframe = ? AND from_time <= ? AND to_time >= ?").get(accountId, symbol, tf, from, to));

/**
 * Bars for a range, from what's stored or from the first connected account that lists the symbol. Prices are the
 * broker's: another account's broker may quote slightly differently, and the page says which source it used.
 */
export async function barsFor(userId: number, symbol: string, tf: Timeframe, from: number, to: number, preferredAccount?: number, nowSeconds = Date.now() / 1000): Promise<BarsAnswer> {
  const accounts = connectionsForPrices(userId, preferredAccount);
  if (accounts.length === 0) return { ok: false, reason: NO_CONNECTION };
  let last = "";

  for (const accountId of accounts) {
    if (alreadyFetched(accountId, symbol, tf, from, to)) {
      const stored = readStored(accountId, symbol, tf, from, to);
      if (stored.length) return { ok: true, bars: stored, accountId };
      last = `Your broker has no price history for ${symbol} at that time.`;
      continue;
    }
    const row = readForSync(accountId);
    if (!row?.password_cipher) continue;
    let password: string;
    try {
      password = decrypt(row.password_cipher);
    } catch {
      last = "The stored MT5 password can't be read, so prices couldn't be fetched. Disconnect and connect again.";
      continue;
    }
    const offset = brokerOffset(accountId);
    const res = await fetchBars({ login: Number(row.login), server: row.server, password, symbol, timeframe: tf, from: from + offset, to: to + offset });
    if (!res.ok) {
      last = reasonFor(res.category, symbol);
      continue;
    }
    const conn = db();
    transaction(conn, () => {
      const insert = conn.prepare("INSERT OR REPLACE INTO market_bars (account_id, symbol, timeframe, time, open, high, low, close) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const [t, o, h, l, c] of res.bars) insert.run(accountId, symbol, tf, t - offset, o, h, l, c);
      // Finished bars only count as fetched: a bar still forming will change.
      const complete = Math.min(to, Math.floor(nowSeconds) - TIMEFRAME_SECONDS[tf]);
      if (complete > from) conn.prepare("INSERT INTO bar_fetches (account_id, symbol, timeframe, from_time, to_time) VALUES (?, ?, ?, ?, ?)").run(accountId, symbol, tf, from, complete);
    });
    const stored = readStored(accountId, symbol, tf, from, to);
    if (stored.length) return { ok: true, bars: stored, accountId };
    last = `Your broker has no price history for ${symbol} at that time.`;
  }
  return { ok: false, reason: last || NO_CONNECTION };
}
