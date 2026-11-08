import "server-only";
import { db, now } from "../db";
import { classifySymbol, sessionFor } from "@/lib/domain/engine/instruments";
import { recalculateTrade, saveBrokerInstrument } from "./journal";
import { brokerOffsetSeconds, settleOffset, type OffsetCandidate, normalizeDeals, type NormalizedTrade, type RawDeal, type RawOrder } from "../mt5/normalize";
import type { SessionPayload } from "../mt5/client";

type Row = Record<string, unknown>;

export type ConnectionState = "connected" | "disconnected" | "syncing" | "error" | "auth_failed";

export interface ConnectionStatus {
  accountId: number;
  accountName: string;
  login: string;
  server: string;
  state: ConnectionState;
  /** Older than twice the interval, or the last attempt failed. Never show these numbers as live. */
  stale: boolean;
  syncEnabled: boolean;
  intervalSeconds: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Seconds since the last successful sync, at the moment of this response. */
  dataAgeSeconds: number | null;
  syncNote: string | null;
  masterPasswordWarning: boolean;
  timeOffsetSeconds: number | null;
  balance: number | null;
  equity: number | null;
  margin: number | null;
  marginFree: number | null;
  marginLevel: number | null;
  floatingPnl: number | null;
  leverage: number | null;
  currency: string | null;
  broker: string | null;
  snapshotAt: string | null;
}

// Named columns, never c.*: password_cipher must not be able to reach a route by accident.
const STATUS_SELECT = `SELECT c.account_id, a.name AS account_name, c.login, c.server, c.status, c.sync_enabled, c.sync_interval_seconds, c.last_attempt_at, c.last_success_at, c.last_error,
    c.balance, c.equity, c.margin, c.margin_free, c.margin_level, c.floating_pnl, c.leverage, c.currency, c.broker, c.snapshot_at,
    (SELECT j.error FROM sync_jobs j WHERE j.account_id = c.account_id AND j.status = 'ok' ORDER BY j.id DESC LIMIT 1) AS sync_note
  FROM mt5_connections c JOIN accounts a ON a.id = c.account_id`;

/** Pure, for testing: the rule for when numbers can no longer be shown as current. */
export function isStale(lastSuccessAt: string | null, lastAttemptAt: string | null, lastError: string | null, intervalSeconds: number, nowMs: number): boolean {
  if (!lastSuccessAt) return true;
  if (lastError && lastAttemptAt && lastAttemptAt >= lastSuccessAt) return true;
  return nowMs - Date.parse(lastSuccessAt) > intervalSeconds * 2000;
}

/** Per-account values with no column of their own. Not secret. */
interface Mt5Meta {
  offsetSeconds: number | null;
  masterPasswordWarning: boolean;
  /** A different offset seen lately, waiting to be confirmed. */
  offsetCandidate?: OffsetCandidate | null;
}

function readMeta(accountId: number): Mt5Meta {
  const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(`mt5:${accountId}`) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as Mt5Meta) : { offsetSeconds: null, masterPasswordWarning: false };
}

function writeMeta(accountId: number, meta: Mt5Meta) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`mt5:${accountId}`, JSON.stringify(meta));
}

function toStatus(r: Row, syncing: Set<number>): ConnectionStatus {
  const accountId = r.account_id as number;
  const [lastSuccessAt, lastAttemptAt, lastError] = [r.last_success_at as string | null, r.last_attempt_at as string | null, r.last_error as string | null];
  const intervalSeconds = r.sync_interval_seconds as number;
  const t = Date.now();
  const meta = readMeta(accountId);
  return {
    accountId,
    accountName: r.account_name as string,
    login: r.login as string,
    server: r.server as string,
    state: syncing.has(accountId) ? "syncing" : (r.status as ConnectionState),
    stale: isStale(lastSuccessAt, lastAttemptAt, lastError, intervalSeconds, t),
    syncEnabled: r.sync_enabled === 1,
    intervalSeconds,
    lastAttemptAt,
    lastSuccessAt,
    lastError,
    dataAgeSeconds: lastSuccessAt ? Math.max(0, Math.round((t - Date.parse(lastSuccessAt)) / 1000)) : null,
    syncNote: r.sync_note as string | null,
    masterPasswordWarning: meta.masterPasswordWarning,
    timeOffsetSeconds: meta.offsetSeconds,
    balance: r.balance as number | null,
    equity: r.equity as number | null,
    margin: r.margin as number | null,
    marginFree: r.margin_free as number | null,
    marginLevel: r.margin_level as number | null,
    floatingPnl: r.floating_pnl as number | null,
    leverage: r.leverage as number | null,
    currency: r.currency as string | null,
    broker: r.broker as string | null,
    snapshotAt: r.snapshot_at as string | null,
  };
}

export function listConnections(userId: number, syncing: Set<number> = new Set()): ConnectionStatus[] {
  return (db().prepare(`${STATUS_SELECT} WHERE a.user_id = ? ORDER BY c.account_id`).all(userId) as Row[]).map((r) => toStatus(r, syncing));
}

export function getConnection(userId: number, accountId: number, syncing: Set<number> = new Set()): ConnectionStatus | null {
  const r = db().prepare(`${STATUS_SELECT} WHERE a.user_id = ? AND c.account_id = ?`).get(userId, accountId) as Row | undefined;
  return r ? toStatus(r, syncing) : null;
}

export function findAccountId(userId: number, login: string, server: string): number | null {
  const r = db()
    .prepare("SELECT c.account_id FROM mt5_connections c JOIN accounts a ON a.id = c.account_id WHERE a.user_id = ? AND c.login = ? AND c.server = ?")
    .get(userId, login, server) as { account_id: number } | undefined;
  return r?.account_id ?? null;
}

/** The stored offset of the broker's clock from UTC, in seconds. Zero when it was never measured. */
export const brokerOffset = (accountId: number): number => readMeta(accountId).offsetSeconds ?? 0;

/** Connections that can be asked for prices: a stored password, not stopped by refusals. Its own account first. */
export function connectionsForPrices(userId: number, preferred?: number): number[] {
  const rows = db()
    .prepare("SELECT c.account_id FROM mt5_connections c JOIN accounts a ON a.id = c.account_id WHERE a.user_id = ? AND c.password_cipher IS NOT NULL AND c.status != 'auth_failed' ORDER BY c.account_id")
    .all(userId) as { account_id: number }[];
  return rows.map((r) => r.account_id).sort((a, b) => Number(b === preferred) - Number(a === preferred));
}

/** True when a connection exists but is paused because MT5 refused its logins. */
export const loginRefused = (userId: number): boolean =>
  Boolean(db().prepare("SELECT 1 FROM mt5_connections c JOIN accounts a ON a.id = c.account_id WHERE a.user_id = ? AND c.password_cipher IS NOT NULL AND c.status = 'auth_failed'").get(userId));

export const REFUSED_REASON = "MT5 refused the last logins, so Jarvis stopped reading from that account. Open Accounts & MT5 and press Sync to try again; if it's refused again, check the investor password.";

/** Everything the sync needs, including the cipher. Server code only, never returned from a route. */
export function readForSync(accountId: number) {
  return db()
    .prepare("SELECT c.account_id, a.user_id, c.login, c.server, c.password_cipher, c.history_synced_to FROM mt5_connections c JOIN accounts a ON a.id = c.account_id WHERE c.account_id = ?")
    .get(accountId) as { account_id: number; user_id: number; login: string; server: string; password_cipher: string | null; history_synced_to: string | null } | undefined;
}

/** Enabled connections with a stored password, skipping those a wrong password has stopped. */
export function listSchedulable() {
  return db()
    .prepare("SELECT account_id, sync_interval_seconds, last_attempt_at FROM mt5_connections WHERE sync_enabled = 1 AND password_cipher IS NOT NULL AND status != 'auth_failed'")
    .all() as { account_id: number; sync_interval_seconds: number; last_attempt_at: string | null }[];
}

export function saveConnection(accountId: number, login: string, server: string, cipher: string) {
  db()
    .prepare(`INSERT INTO mt5_connections (account_id, login, server, password_cipher, status, created_at) VALUES (?, ?, ?, ?, 'connected', ?)
      ON CONFLICT(account_id) DO UPDATE SET password_cipher = excluded.password_cipher, status = 'connected', last_error = NULL`)
    .run(accountId, login, server, cipher, now());
}

export function updateSettings(accountId: number, patch: { intervalSeconds?: number; enabled?: boolean }) {
  if (patch.intervalSeconds !== undefined) db().prepare("UPDATE mt5_connections SET sync_interval_seconds = ? WHERE account_id = ?").run(patch.intervalSeconds, accountId);
  if (patch.enabled !== undefined) db().prepare("UPDATE mt5_connections SET sync_enabled = ? WHERE account_id = ?").run(patch.enabled ? 1 : 0, accountId);
}

/** Forgets the password and the live view. The account and its trades stay. */
export function clearConnection(accountId: number) {
  const conn = db();
  conn.prepare("UPDATE mt5_connections SET password_cipher = NULL, status = 'disconnected', last_error = NULL WHERE account_id = ?").run(accountId);
  conn.prepare("DELETE FROM open_positions WHERE account_id = ?").run(accountId);
  conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
}

export function listOpenPositions(accountId: number) {
  return db()
    .prepare("SELECT broker_position_id, symbol, side, volume, price_open, price_current, stop_loss, take_profit, swap, profit, opened_at, synced_at FROM open_positions WHERE account_id = ? ORDER BY opened_at DESC")
    .all(accountId);
}

const JOBS_KEPT = 500;

export function startJob(accountId: number, at: string): number {
  return Number(db().prepare("INSERT INTO sync_jobs (account_id, started_at) VALUES (?, ?)").run(accountId, at).lastInsertRowid);
}

export function finishJob(jobId: number, accountId: number, status: "ok" | "failed", counts: Partial<ApplyResult>, error: string | null) {
  const conn = db();
  conn.prepare("UPDATE sync_jobs SET finished_at = ?, status = ?, deals_seen = ?, deals_new = ?, trades_created = ?, trades_updated = ?, error = ? WHERE id = ?")
    .run(now(), status, counts.dealsSeen ?? 0, counts.dealsNew ?? 0, counts.tradesCreated ?? 0, counts.tradesUpdated ?? 0, error, jobId);
  conn.prepare("DELETE FROM sync_jobs WHERE account_id = ? AND id <= ?").run(accountId, jobId - JOBS_KEPT);
}

/** How many jobs right before this one ended with one of these errors. */
export function priorRefusals(accountId: number, jobId: number, errors: string[]): number {
  const rows = db().prepare("SELECT error FROM sync_jobs WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT 10").all(accountId, jobId) as { error: string | null }[];
  const stopAt = rows.findIndex((r) => !r.error || !errors.includes(r.error));
  return stopAt === -1 ? rows.length : stopAt;
}

export function recordFailure(accountId: number, at: string, message: string, authFailed: boolean) {
  db().prepare("UPDATE mt5_connections SET last_attempt_at = ?, last_error = ?, status = ? WHERE account_id = ?").run(at, message, authFailed ? "auth_failed" : "error", accountId);
}

export interface ApplyResult {
  dealsSeen: number;
  dealsNew: number;
  tradesCreated: number;
  tradesUpdated: number;
  /** Plain-words remarks about skipped data, or null. */
  note: string | null;
}

const toIso = (seconds: number | null | undefined, offset: number) => (seconds ? new Date((seconds - offset) * 1000).toISOString() : null);
const level = (n: number | null | undefined) => (n ? n : null);

function upsertOrders(accountId: number, orders: RawOrder[], offset: number, at: string) {
  const stmt = db().prepare(`INSERT INTO orders (account_id, broker_order_id, broker_position_id, symbol, type, state, volume_initial, volume_current, price_open, stop_loss, take_profit, time_setup, time_done, raw, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, broker_order_id) DO UPDATE SET broker_position_id = excluded.broker_position_id, symbol = excluded.symbol, type = excluded.type, state = excluded.state,
      volume_initial = excluded.volume_initial, volume_current = excluded.volume_current, price_open = excluded.price_open, stop_loss = excluded.stop_loss, take_profit = excluded.take_profit,
      time_setup = excluded.time_setup, time_done = excluded.time_done, raw = excluded.raw, updated_at = excluded.updated_at`);
  for (const o of orders) {
    const r = o as RawOrder & { symbol: string; type: number; state: number; volume_initial: number; volume_current: number; price_open: number; time_setup: number; time_done: number };
    stmt.run(accountId, String(r.ticket), r.position_id ? String(r.position_id) : null, r.symbol, r.type, r.state, r.volume_initial, r.volume_current, r.price_open, level(r.sl), level(r.tp),
      toIso(r.time_setup, offset), toIso(r.time_done, offset), JSON.stringify(o), at);
  }
}

/** An incremental window can cut a position in half, so stored deals and orders are merged back in. */
function mergeStored(accountId: number, payload: SessionPayload) {
  const conn = db();
  const positionIds = [...new Set(payload.deals.filter((d) => d.position_id).map((d) => String(d.position_id)))];
  const stored = conn.prepare("SELECT raw FROM executions WHERE account_id = ? AND raw IS NOT NULL AND broker_position_id IN (SELECT value FROM json_each(?))").all(accountId, JSON.stringify(positionIds)) as { raw: string }[];
  const deals = new Map<number, RawDeal>(stored.map((r) => JSON.parse(r.raw) as RawDeal).map((d) => [d.ticket, d]));
  for (const d of payload.deals) deals.set(d.ticket, d);

  const orderIds = [...new Set([...deals.values()].map((d) => String(d.order)))];
  const orders = conn.prepare("SELECT raw FROM orders WHERE account_id = ? AND raw IS NOT NULL AND broker_order_id IN (SELECT value FROM json_each(?))").all(accountId, JSON.stringify(orderIds)) as { raw: string }[];
  return { deals: [...deals.values()], orders: orders.map((r) => JSON.parse(r.raw) as RawOrder) };
}

function writeTrade(userId: number, accountId: number, t: NormalizedTrade, contractSize: number | null, at: string): { created: boolean; newDeals: number } {
  const conn = db();
  const first = t.fills[0];
  // Risk from a guessed contract size would be off by a huge factor, so without one there is no stop yet.
  const stop = contractSize === null ? null : t.stopPrice;
  const existing = conn.prepare("SELECT id FROM trades WHERE account_id = ? AND source = 'mt5' AND source_key = ?").get(accountId, t.sourceKey) as { id: number } | undefined;
  let tradeId: number;
  if (existing) {
    tradeId = existing.id;
    // Only broker facts. Annotations are never named here, and a stop the user entered is kept.
    conn.prepare(`UPDATE trades SET multiplier = ?, commission = ?, swap = ?, other_fees = ?, broker_profit = ?, session = ?,
        stop_price = COALESCE(stop_price, ?), target_price = COALESCE(target_price, ?) WHERE id = ?`)
      .run(contractSize ?? 1, t.commission, t.swap, t.otherFees, t.brokerProfit, sessionFor(first.executedAt), stop, t.targetPrice, tradeId);
  } else {
    tradeId = Number(conn.prepare(`INSERT INTO trades (user_id, account_id, symbol, side, asset_class, session, opened_at, entry_price, quantity, multiplier, stop_price, target_price,
        commission, swap, other_fees, broker_profit, broker_position_id, source, source_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mt5', ?, ?, ?)`)
      .run(userId, accountId, t.symbol, t.side, classifySymbol(t.symbol), sessionFor(first.executedAt), first.executedAt, first.price, first.quantity, contractSize ?? 1, stop, t.targetPrice,
        t.commission, t.swap, t.otherFees, t.brokerProfit, t.positionId, t.sourceKey, at, at).lastInsertRowid);
  }

  const known = new Set((conn.prepare("SELECT broker_deal_id FROM executions WHERE trade_id = ?").all(tradeId) as { broker_deal_id: string | null }[]).map((r) => r.broker_deal_id));
  const upsert = conn.prepare(`INSERT INTO executions (trade_id, account_id, role, price, quantity, executed_at, commission, swap, fee, profit, source, broker_deal_id, broker_order_id, broker_position_id, raw, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mt5', ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, broker_deal_id) WHERE broker_deal_id IS NOT NULL DO UPDATE SET trade_id = excluded.trade_id, role = excluded.role, price = excluded.price, quantity = excluded.quantity,
      executed_at = excluded.executed_at, commission = excluded.commission, swap = excluded.swap, fee = excluded.fee, profit = excluded.profit, raw = excluded.raw`);
  let newDeals = 0;
  for (const f of t.fills) {
    if (!known.has(f.brokerDealId)) newDeals++;
    upsert.run(tradeId, accountId, f.role, f.price, f.quantity, f.executedAt, f.commission, f.swap, f.fee, f.profit, f.brokerDealId, f.brokerOrderId, f.brokerPositionId, f.raw, at);
  }
  // A deal the broker later cancelled drops out of the fills, so its row must go too.
  conn.prepare("DELETE FROM executions WHERE trade_id = ? AND broker_deal_id IS NOT NULL AND broker_deal_id NOT IN (SELECT value FROM json_each(?))").run(tradeId, JSON.stringify(t.fills.map((f) => f.brokerDealId)));
  if (newDeals > 0) conn.prepare("UPDATE trades SET updated_at = ?, mae = NULL, mfe = NULL, excursion_note = NULL WHERE id = ?").run(at, tradeId);
  recalculateTrade(tradeId);
  return { created: !existing, newDeals };
}

/**
 * Writes one session's data. Safe to run twice on the same payload, and the caller holds the
 * transaction. Trades take only broker facts here: annotation columns are never written.
 */
export function applyPayload(userId: number, accountId: number, payload: SessionPayload, at: string): ApplyResult {
  const conn = db();
  const previous = readMeta(accountId);
  const measured = brokerOffsetSeconds(payload.quote_time, payload.utc_now);
  const settled = settleOffset(previous.offsetSeconds, previous.offsetCandidate, measured, payload.quote_time);
  const offset = settled.offset ?? 0;

  for (const s of Object.values(payload.symbols)) {
    saveBrokerInstrument(accountId, {
      symbol: s.name,
      assetClass: classifySymbol(s.name),
      contractSize: s.trade_contract_size,
      digits: s.digits,
      point: s.point,
      tickSize: s.trade_tick_size,
      tickValue: s.trade_tick_value,
      pipSize: null,
      baseCurrency: s.currency_base,
      quoteCurrency: s.currency_profit,
      profitCurrency: s.currency_profit,
    });
  }

  upsertOrders(accountId, [...payload.history_orders, ...payload.orders], offset, at);
  const merged = mergeStored(accountId, payload);
  const normalized = normalizeDeals(merged.deals, merged.orders, offset);

  const specs = new Map((conn.prepare("SELECT symbol, contract_size FROM instruments WHERE account_id = ?").all(accountId) as { symbol: string; contract_size: number | null }[]).map((r) => [r.symbol, r.contract_size]));
  const result: ApplyResult = { dealsSeen: payload.deals.length, dealsNew: 0, tradesCreated: 0, tradesUpdated: 0, note: null };
  const noSpec = new Set<string>();
  for (const t of normalized.trades) {
    const size = specs.get(t.symbol) ?? null;
    if (size === null) noSpec.add(t.symbol);
    const { created, newDeals } = writeTrade(userId, accountId, t, size, at);
    result.dealsNew += newDeals;
    if (created) result.tradesCreated++;
    else if (newDeals > 0) result.tradesUpdated++;
  }

  conn.prepare("DELETE FROM open_positions WHERE account_id = ?").run(accountId);
  const addPosition = conn.prepare(`INSERT INTO open_positions (account_id, broker_position_id, symbol, side, volume, price_open, price_current, stop_loss, take_profit, swap, profit, opened_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of payload.positions) {
    addPosition.run(accountId, String(p.identifier), p.symbol, p.type === 0 ? "long" : "short", p.volume, p.price_open, p.price_current, level(p.sl), level(p.tp), p.swap, p.profit, toIso(p.time_msc ? p.time_msc / 1000 : p.time, offset), at);
  }

  const a = payload.account;
  conn.prepare(`UPDATE mt5_connections SET status = 'connected', last_attempt_at = ?, last_success_at = ?, last_error = NULL, history_synced_to = ?,
      balance = ?, equity = ?, margin = ?, margin_free = ?, margin_level = ?, floating_pnl = ?, leverage = ?, currency = ?, broker = ?, margin_mode = ?, snapshot_at = ? WHERE account_id = ?`)
    .run(at, at, at, a.balance, a.equity, a.margin, a.margin_free, a.margin_level, a.profit, a.leverage, a.currency, a.company, a.margin_mode, at, accountId);
  // Docs: trade_allowed is off under an investor password. On means the stored password can trade.
  writeMeta(accountId, { offsetSeconds: settled.offset, offsetCandidate: settled.candidate, masterPasswordWarning: a.trade_allowed === true });
  // Older deals were stored with the old offset, so the next sync reads the whole history again.
  if (settled.changed) conn.prepare("UPDATE mt5_connections SET history_synced_to = NULL WHERE account_id = ?").run(accountId);

  const notes = [
    normalized.incomplete.length && `${normalized.incomplete.length} position(s) skipped because their history is incomplete: ${normalized.incomplete.map((i) => `#${i.positionId}`).slice(0, 10).join(", ")}.`,
    normalized.cancelled.length && `The broker cancelled deals on position(s) ${[...new Set(normalized.cancelled)].slice(0, 10).map((p) => `#${p}`).join(", ")}. Please review those trades.`,
    noSpec.size && `No contract size from the broker for ${[...noSpec].join(", ")}, so risk and R are blank on those trades.`,
    measured === null && previous.offsetSeconds === null && "Broker time offset unknown, so times are shown as the broker reported them.",
    settled.changed && "The broker's clock changed, so trade times are being read again.",
  ].filter(Boolean);
  result.note = notes.length ? notes.join(" ") : null;
  return result;
}

/** A first sync that couldn't measure the offset gets redone in full once it can. */
export function needsFullHistory(accountId: number): boolean {
  const r = db().prepare("SELECT history_synced_to FROM mt5_connections WHERE account_id = ?").get(accountId) as { history_synced_to: string | null } | undefined;
  return !r?.history_synced_to || readMeta(accountId).offsetSeconds === null;
}
