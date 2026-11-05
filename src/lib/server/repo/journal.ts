import "server-only";
import { randomUUID } from "node:crypto";
import { dataPath, db, now, purgeDeletedTrades, transaction } from "../db";
import { audit } from "./audit";
import { unlinkSync } from "node:fs";
import path from "node:path";
import type { Account, AccountInput, Attachment, Execution, Trade, TradeData, TradeSource } from "@/lib/domain/types";
import { classifySymbol, sessionFor, type AssetClass } from "@/lib/domain/engine/instruments";
import { computePosition, type Fill } from "@/lib/domain/engine/position";

type Row = Record<string, unknown>;

// ---------- accounts ----------

function toAccount(r: Row): Account {
  return {
    id: r.id as number,
    name: r.name as string,
    broker: r.broker as string,
    currency: r.currency as string,
    startingBalance: r.starting_balance as number,
    archived: r.archived === 1,
    isSample: r.is_sample === 1,
    source: (r.source as Account["source"]) ?? "manual",
    createdAt: r.created_at as string,
  };
}

export function listAccounts(userId: number, includeArchived = true): Account[] {
  const rows = db()
    .prepare(`SELECT * FROM accounts WHERE user_id = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY archived, id`)
    .all(userId) as Row[];
  return rows.map(toAccount);
}

export function getAccount(userId: number, id: number): Account | null {
  const r = db().prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? toAccount(r) : null;
}

export function createAccount(userId: number, a: AccountInput, opts: { isSample?: boolean; source?: Account["source"] } = {}): Account {
  const res = db()
    .prepare("INSERT INTO accounts (user_id, name, broker, currency, starting_balance, is_sample, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(userId, a.name, a.broker, a.currency, a.startingBalance, opts.isSample ? 1 : 0, opts.source ?? "manual", now());
  return getAccount(userId, Number(res.lastInsertRowid)) as Account;
}

export function updateAccount(userId: number, id: number, a: Partial<AccountInput> & { archived?: boolean }): Account | null {
  const cur = getAccount(userId, id);
  if (!cur) return null;
  const next = { ...cur, ...a };
  db()
    .prepare("UPDATE accounts SET name = ?, broker = ?, currency = ?, starting_balance = ?, archived = ? WHERE id = ? AND user_id = ?")
    .run(next.name, next.broker, next.currency, next.startingBalance, next.archived ? 1 : 0, id, userId);
  recalculateAccount(id);
  return getAccount(userId, id);
}

export function ensureDefaultAccount(userId: number): Account {
  const existing = listAccounts(userId, false).find((a) => !a.isSample) ?? listAccounts(userId, false)[0];
  if (existing) return existing;
  return createAccount(userId, { name: "Main account", broker: "", currency: "USD", startingBalance: 0 });
}

// ---------- strategies, tags, instruments ----------

function strategyId(userId: number, name: string): number | null {
  if (!name) return null;
  const conn = db();
  conn.prepare("INSERT OR IGNORE INTO strategies (user_id, name, created_at) VALUES (?, ?, ?)").run(userId, name, now());
  return (conn.prepare("SELECT id FROM strategies WHERE user_id = ? AND name = ?").get(userId, name) as { id: number }).id;
}

export function listStrategies(userId: number) {
  return db().prepare("SELECT id, name, description FROM strategies WHERE user_id = ? ORDER BY name").all(userId) as { id: number; name: string; description: string }[];
}

function setTags(userId: number, tradeId: number, names: string[], kind: "custom" | "strategy") {
  const conn = db();
  conn.prepare("DELETE FROM trade_tags WHERE trade_id = ? AND tag_id IN (SELECT id FROM tags WHERE kind = ?)").run(tradeId, kind);
  for (const name of new Set(names)) {
    conn.prepare("INSERT OR IGNORE INTO tags (user_id, name, kind) VALUES (?, ?, ?)").run(userId, name, kind);
    const tag = conn.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ? AND kind = ?").get(userId, name, kind) as { id: number };
    conn.prepare("INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)").run(tradeId, tag.id);
  }
}

export interface InstrumentSpec {
  symbol: string;
  assetClass: AssetClass;
  contractSize: number | null;
  digits: number | null;
  point: number | null;
  tickSize: number | null;
  tickValue: number | null;
  pipSize: number | null;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  profitCurrency: string | null;
  source: "user" | "mt5";
}

function toInstrument(r: Row): InstrumentSpec {
  return {
    symbol: r.symbol as string,
    assetClass: r.asset_class as AssetClass,
    contractSize: r.contract_size as number | null,
    digits: r.digits as number | null,
    point: r.point as number | null,
    tickSize: r.tick_size as number | null,
    tickValue: r.tick_value as number | null,
    pipSize: r.pip_size as number | null,
    baseCurrency: r.base_currency as string | null,
    quoteCurrency: r.quote_currency as string | null,
    profitCurrency: r.profit_currency as string | null,
    source: r.source as "user" | "mt5",
  };
}

export function listInstruments(userId: number, accountId: number): InstrumentSpec[] {
  if (!getAccount(userId, accountId)) return [];
  return (db().prepare("SELECT * FROM instruments WHERE account_id = ? ORDER BY symbol").all(accountId) as Row[]).map(toInstrument);
}

/** Remembers what the user entered for a symbol, without touching a spec the broker reported. */
function rememberInstrument(accountId: number, symbol: string, assetClass: AssetClass, contractSize: number) {
  db()
    .prepare(
      `INSERT INTO instruments (account_id, symbol, asset_class, contract_size, source, updated_at) VALUES (?, ?, ?, ?, 'user', ?)
       ON CONFLICT(account_id, symbol) DO UPDATE SET contract_size = excluded.contract_size, asset_class = excluded.asset_class, updated_at = excluded.updated_at
       WHERE instruments.source = 'user'`,
    )
    .run(accountId, symbol, assetClass, contractSize, now());
}

/** For the MT5 sync: broker specs always win over what was typed. */
export function saveBrokerInstrument(accountId: number, s: Omit<InstrumentSpec, "source">) {
  db()
    .prepare(
      `INSERT INTO instruments (account_id, symbol, asset_class, contract_size, digits, point, tick_size, tick_value, pip_size, base_currency, quote_currency, profit_currency, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mt5', ?)
       ON CONFLICT(account_id, symbol) DO UPDATE SET asset_class = excluded.asset_class, contract_size = excluded.contract_size, digits = excluded.digits,
         point = excluded.point, tick_size = excluded.tick_size, tick_value = excluded.tick_value, pip_size = excluded.pip_size,
         base_currency = excluded.base_currency, quote_currency = excluded.quote_currency, profit_currency = excluded.profit_currency, source = 'mt5', updated_at = excluded.updated_at`,
    )
    .run(accountId, s.symbol, s.assetClass, s.contractSize, s.digits, s.point, s.tickSize, s.tickValue, s.pipSize, s.baseCurrency, s.quoteCurrency, s.profitCurrency, now());
}

// ---------- trades ----------

const TRADE_SELECT = `SELECT t.*, s.name AS strategy_name,
  (SELECT json_group_array(g.name) FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.trade_id = t.id AND g.kind = 'custom') AS tag_names,
  (SELECT json_group_array(g.name) FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.trade_id = t.id AND g.kind = 'strategy') AS strategy_tag_names
  FROM trades t LEFT JOIN strategies s ON s.id = t.strategy_id`;

function toTrade(r: Row): Trade {
  return {
    id: r.id as number,
    accountId: r.account_id as number,
    symbol: r.symbol as string,
    side: r.side as "long" | "short",
    assetClass: r.asset_class as AssetClass,
    session: r.session as Trade["session"],
    openedAt: r.opened_at as string,
    closedAt: (r.closed_at as string | null) ?? null,
    entryPrice: r.entry_price as number,
    exitPrice: (r.exit_price as number | null) ?? null,
    quantity: r.quantity as number,
    multiplier: r.multiplier as number,
    stopPrice: (r.stop_price as number | null) ?? null,
    targetPrice: (r.target_price as number | null) ?? null,
    commission: r.commission as number,
    swap: r.swap as number,
    otherFees: r.other_fees as number,
    fxRate: r.fx_rate as number | null,
    setup: r.setup as string,
    strategy: (r.strategy_name as string | null) ?? "",
    tags: JSON.parse(r.tag_names as string),
    strategyTags: JSON.parse(r.strategy_tag_names as string),
    emotionBefore: (r.emotion_before as Trade["emotionBefore"]) ?? null,
    emotionAfter: (r.emotion_after as Trade["emotionAfter"]) ?? null,
    followedPlan: r.followed_plan === null ? null : r.followed_plan === 1,
    grade: (r.grade as Trade["grade"]) ?? null,
    planNotes: r.plan_notes as string,
    notes: r.notes as string,
    entryReason: r.entry_reason as string,
    exitReason: r.exit_reason as string,
    lessons: r.lessons as string,
    mistakes: JSON.parse(r.mistakes as string),
    confidence: r.confidence as number | null,
    discipline: r.discipline as number | null,
    fear: r.fear as number | null,
    greed: r.greed as number | null,
    revengeTrade: r.revenge_trade === 1,
    overtrading: r.overtrading === 1,
    impulsiveEntry: r.impulsive_entry === 1,
    earlyExit: r.early_exit === 1,
    ruleViolations: r.rule_violations as string,
    source: r.source as TradeSource,
    importBatch: (r.import_batch as string | null) ?? null,
    brokerPositionId: (r.broker_position_id as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    status: r.status as Trade["status"],
    pnlStatus: r.pnl_status as Trade["pnlStatus"],
    remainingQty: r.remaining_qty as number,
    grossPnl: r.gross_pnl as number | null,
    pnl: r.net_pnl as number | null,
    riskAmount: r.risk_amount as number | null,
    rMultiple: r.r_multiple as number | null,
    plannedR: r.planned_r as number | null,
    holdingMinutes: r.holding_minutes as number | null,
  };
}

export interface TradeFilters {
  accountId?: number;
  symbol?: string;
  strategy?: string;
  from?: string;
  to?: string;
  source?: TradeSource;
  outcome?: "win" | "loss" | "breakeven" | "open" | "pending";
  /** Close-time window, for a calendar day. `from` and `to` are open-time. */
  closedFrom?: string;
  closedTo?: string;
  plan?: "on" | "off" | "unanswered";
  session?: string;
  tag?: string;
  q?: string;
  currency?: string;
  /** Sample trades stay out of results unless asked for, so they can't pass as real figures. */
  includeSample?: boolean;
}

function whereClause(userId: number, f: TradeFilters): { sql: string; args: (string | number)[] } {
  const where = ["t.user_id = ?", "t.deleted_at IS NULL"];
  const args: (string | number)[] = [userId];
  const add = (sql: string, ...values: (string | number)[]) => {
    where.push(sql);
    args.push(...values);
  };
  if (f.accountId) add("t.account_id = ?", f.accountId);
  if (f.symbol) add("t.symbol = ?", f.symbol.toUpperCase());
  if (f.strategy) add("s.name = ?", f.strategy);
  if (f.from) add("t.opened_at >= ?", f.from);
  if (f.to) add("t.opened_at <= ?", f.to);
  if (f.source) add("t.source = ?", f.source);
  else if (!f.includeSample && !f.accountId) add("t.source != 'sample'");
  if (f.session) add("t.session = ?", f.session);
  if (f.currency) add("t.account_id IN (SELECT id FROM accounts WHERE user_id = ? AND currency = ?)", userId, f.currency);
  if (f.outcome === "win") add("t.status = 'closed' AND t.net_pnl > 0");
  if (f.outcome === "loss") add("t.status = 'closed' AND t.net_pnl < 0");
  if (f.outcome === "breakeven") add("t.status = 'closed' AND t.net_pnl = 0");
  if (f.outcome === "open") add("t.status != 'closed'");
  if (f.outcome === "pending") add("t.pnl_status != 'ok'");
  if (f.closedFrom) add("t.closed_at >= ?", f.closedFrom);
  if (f.closedTo) add("t.closed_at <= ?", f.closedTo);
  if (f.plan === "on") add("t.followed_plan = 1");
  if (f.plan === "off") add("t.followed_plan = 0");
  if (f.plan === "unanswered") add("t.followed_plan IS NULL");
  if (f.tag) add("t.id IN (SELECT tt.trade_id FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE g.name = ?)", f.tag);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    const idMatch = /^#?(\d+)$/.exec(f.q.trim());
    add(
      `(t.symbol LIKE ? ESCAPE '\\' OR t.setup LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR t.plan_notes LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\'
        OR t.id IN (SELECT tt.trade_id FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE g.name LIKE ? ESCAPE '\\')${idMatch ? " OR t.id = ?" : ""})`,
      like, like, like, like, like, like, ...(idMatch ? [Number(idMatch[1])] : []),
    );
  }
  return { sql: where.join(" AND "), args };
}

export type TradeSort = "openedAt" | "closedAt" | "pnl" | "rMultiple" | "symbol" | "quantity";
const SORT_COLUMNS: Record<TradeSort, string> = { openedAt: "t.opened_at", closedAt: "t.closed_at", pnl: "t.net_pnl", rMultiple: "t.r_multiple", symbol: "t.symbol", quantity: "t.quantity" };

export function listTradesPage(userId: number, f: TradeFilters, sort: TradeSort, dir: "asc" | "desc", page: number, pageSize: number): { trades: Trade[]; total: number } {
  const { sql, args } = whereClause(userId, f);
  const conn = db();
  const total = (conn.prepare(`SELECT COUNT(*) AS n FROM trades t LEFT JOIN strategies s ON s.id = t.strategy_id WHERE ${sql}`).get(...args) as { n: number }).n;
  const rows = conn
    .prepare(`${TRADE_SELECT} WHERE ${sql} ORDER BY ${SORT_COLUMNS[sort]} IS NULL, ${SORT_COLUMNS[sort]} ${dir === "asc" ? "ASC" : "DESC"}, t.id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize) as Row[];
  return { trades: rows.map(toTrade), total };
}

/** Everything matching, newest first, for analytics and Jarvis's context. */
export function listTrades(userId: number, f: TradeFilters = {}): Trade[] {
  const { sql, args } = whereClause(userId, f);
  return (db().prepare(`${TRADE_SELECT} WHERE ${sql} ORDER BY t.opened_at DESC, t.id DESC`).all(...args) as Row[]).map(toTrade);
}

export function listFacets(userId: number) {
  const conn = db();
  const symbols = conn.prepare("SELECT DISTINCT symbol FROM trades WHERE user_id = ? AND deleted_at IS NULL ORDER BY symbol").all(userId) as { symbol: string }[];
  const tags = conn.prepare("SELECT DISTINCT name, kind FROM tags WHERE user_id = ? ORDER BY name").all(userId) as { name: string; kind: string }[];
  return { symbols: symbols.map((s) => s.symbol), tags, strategies: listStrategies(userId).map((s) => s.name) };
}

function toExecution(r: Row): Execution {
  return {
    id: r.id as number,
    role: r.role as Execution["role"],
    price: r.price as number,
    quantity: r.quantity as number,
    executedAt: r.executed_at as string,
    commission: r.commission as number,
    swap: r.swap as number,
    fee: r.fee as number,
    profit: r.profit as number | null,
    source: r.source as string,
    brokerDealId: r.broker_deal_id as string | null,
    brokerOrderId: r.broker_order_id as string | null,
    brokerPositionId: r.broker_position_id as string | null,
  };
}

export function listAttachments(tradeId: number): Attachment[] {
  const rows = db().prepare("SELECT id, trade_id, kind, filename, mime, size, created_at FROM attachments WHERE trade_id = ? ORDER BY id").all(tradeId) as Row[];
  return rows.map((r) => ({ id: r.id as number, tradeId: r.trade_id as number, kind: r.kind as Attachment["kind"], filename: r.filename as string, mime: r.mime as string, size: r.size as number, createdAt: r.created_at as string }));
}

export function getTrade(userId: number, id: number): Trade | null {
  const r = db().prepare(`${TRADE_SELECT} WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL`).get(id, userId) as Row | undefined;
  if (!r) return null;
  return {
    ...toTrade(r),
    executions: (db().prepare("SELECT * FROM executions WHERE trade_id = ? ORDER BY executed_at, id").all(id) as Row[]).map(toExecution),
    attachments: listAttachments(id),
  };
}

const iso = (v: string) => new Date(v).toISOString();

/** Re-derives a trade's stored results from its fills. The only writer of those columns. */
export function recalculateTrade(tradeId: number) {
  const conn = db();
  const t = conn
    .prepare(`SELECT t.*, a.currency AS account_currency, i.profit_currency FROM trades t JOIN accounts a ON a.id = t.account_id
      LEFT JOIN instruments i ON i.account_id = t.account_id AND i.symbol = t.symbol WHERE t.id = ?`)
    .get(tradeId) as Row | undefined;
  if (!t) return;
  const fills = conn.prepare("SELECT * FROM executions WHERE trade_id = ? ORDER BY executed_at, id").all(tradeId) as Row[];
  const pick = (role: string): Fill[] => fills.filter((f) => f.role === role).map((f) => ({ price: f.price as number, qty: f.quantity as number }));
  const [entries, exits] = [pick("entry"), pick("exit")];
  if (entries.length === 0) return;
  const brokerProfit = t.broker_profit as number | null;
  const r = computePosition({
    side: t.side as "long" | "short",
    symbol: t.symbol as string,
    accountCurrency: t.account_currency as string,
    profitCurrency: t.profit_currency as string | null,
    contractSize: t.multiplier as number,
    fxRate: t.fx_rate as number | null,
    entries,
    exits,
    commission: t.commission as number,
    swap: t.swap as number,
    otherFees: t.other_fees as number,
    stopPrice: t.stop_price as number | null,
    targetPrice: t.target_price as number | null,
    brokerProfit: exits.length ? brokerProfit : null,
  });
  const openedAt = fills.find((f) => f.role === "entry")!.executed_at as string;
  const lastExit = fills.filter((f) => f.role === "exit").at(-1)?.executed_at as string | undefined;
  const closedAt = r.status === "closed" ? (lastExit ?? null) : null;
  conn
    .prepare(`UPDATE trades SET opened_at = ?, closed_at = ?, entry_price = ?, exit_price = ?, quantity = ?, status = ?, pnl_status = ?, remaining_qty = ?,
      gross_pnl = ?, net_pnl = ?, risk_amount = ?, r_multiple = ?, planned_r = ?, holding_minutes = ? WHERE id = ?`)
    .run(openedAt, closedAt, r.avgEntry, r.avgExit, r.enteredQty, r.status, r.pnlStatus, r.remainingQty, r.grossPnl, r.netPnl, r.initialRisk, r.rMultiple, r.plannedR,
      closedAt ? (Date.parse(closedAt) - Date.parse(openedAt)) / 60000 : null, tradeId);
}

export function recalculateAccount(accountId: number) {
  const rows = db().prepare("SELECT id FROM trades WHERE account_id = ?").all(accountId) as { id: number }[];
  for (const { id } of rows) recalculateTrade(id);
}

function writeFills(tradeId: number, accountId: number, source: string, t: TradeData) {
  const conn = db();
  conn.prepare("DELETE FROM executions WHERE trade_id = ? AND broker_deal_id IS NULL").run(tradeId);
  const fills = t.executions?.length
    ? t.executions
    : [
        { role: "entry" as const, price: t.entryPrice, quantity: t.quantity, executedAt: t.openedAt },
        ...(t.exitPrice !== null && t.closedAt ? [{ role: "exit" as const, price: t.exitPrice, quantity: t.quantity, executedAt: t.closedAt }] : []),
      ];
  const insert = conn.prepare("INSERT INTO executions (trade_id, account_id, role, price, quantity, executed_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const f of fills) insert.run(tradeId, accountId, f.role, f.price, f.quantity, iso(f.executedAt), source, now());
}

const ANNOTATIONS = ["setup", "emotion_before", "emotion_after", "followed_plan", "grade", "plan_notes", "notes", "entry_reason", "exit_reason", "lessons", "mistakes",
  "confidence", "discipline", "fear", "greed", "revenge_trade", "overtrading", "impulsive_entry", "early_exit", "rule_violations", "strategy_id"];

const bool = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

function annotationValues(userId: number, t: TradeData) {
  return [t.setup, t.emotionBefore, t.emotionAfter, bool(t.followedPlan), t.grade, t.planNotes, t.notes, t.entryReason, t.exitReason, t.lessons, JSON.stringify(t.mistakes),
    t.confidence, t.discipline, t.fear, t.greed, bool(t.revengeTrade), bool(t.overtrading), bool(t.impulsiveEntry), bool(t.earlyExit), t.ruleViolations, strategyId(userId, t.strategy)];
}

const MARKET = ["account_id", "symbol", "side", "asset_class", "session", "opened_at", "closed_at", "entry_price", "exit_price", "quantity", "multiplier", "stop_price", "target_price", "commission", "swap", "other_fees", "fx_rate"];

function marketValues(t: TradeData) {
  const assetClass = t.assetClass ?? classifySymbol(t.symbol);
  return [t.accountId, t.symbol, t.side, assetClass, t.session ?? sessionFor(t.openedAt), iso(t.openedAt), t.closedAt ? iso(t.closedAt) : null, t.entryPrice, t.exitPrice, t.quantity, t.multiplier,
    t.stopPrice, t.targetPrice, t.commission, t.swap, t.otherFees, t.fxRate];
}

export interface TradeOrigin {
  source?: TradeSource;
  importBatch?: string | null;
  sourceKey?: string | null;
}

/** No transaction of its own, so an import can wrap many of these in one. */
function insertTrade(userId: number, t: TradeData, origin: TradeOrigin): number {
  const source = origin.source ?? "manual";
  const ts = now();
  const cols = [...MARKET, ...ANNOTATIONS, "user_id", "source", "import_batch", "source_key", "created_at", "updated_at"];
  const res = db()
    .prepare(`INSERT INTO trades (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .run(...marketValues(t), ...annotationValues(userId, t), userId, source, origin.importBatch ?? null, origin.sourceKey ?? null, ts, ts);
  const id = Number(res.lastInsertRowid);
  writeFills(id, t.accountId, source, t);
  setTags(userId, id, t.tags, "custom");
  setTags(userId, id, t.strategyTags, "strategy");
  rememberInstrument(t.accountId, t.symbol, t.assetClass ?? classifySymbol(t.symbol), t.multiplier);
  recalculateTrade(id);
  return id;
}

export function createTrade(userId: number, t: TradeData, origin: TradeOrigin = {}): Trade {
  const id = transaction(db(), () => {
    const created = insertTrade(userId, t, origin);
    audit(userId, "trade.created", "trade", created, { source: origin.source ?? "manual" });
    return created;
  });
  return getTrade(userId, id) as Trade;
}

/**
 * Synced trades take annotations only: their prices, sizes and costs belong to the broker,
 * and the next sync must not disagree with an edit. The stop and target stay editable
 * because MT5 often has no record of the original stop, and R depends on it.
 */
export function updateTrade(userId: number, id: number, t: TradeData): Trade | null {
  const existing = db().prepare("SELECT source FROM trades WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as { source: string } | undefined;
  if (!existing) return null;
  const synced = existing.source === "mt5";
  const cols = synced ? ["stop_price", "target_price", ...ANNOTATIONS] : [...MARKET, ...ANNOTATIONS];
  const values = synced ? [t.stopPrice, t.targetPrice, ...annotationValues(userId, t)] : [...marketValues(t), ...annotationValues(userId, t)];
  transaction(db(), () => {
    db().prepare(`UPDATE trades SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...values, now(), id, userId);
    if (!synced) writeFills(id, t.accountId, existing.source, t);
    setTags(userId, id, t.tags, "custom");
    setTags(userId, id, t.strategyTags, "strategy");
    recalculateTrade(id);
    audit(userId, "trade.updated", "trade", id);
  });
  return getTrade(userId, id);
}

/** A manual copy, for logging a similar trade. Broker identifiers and attachments stay with the original. */
export function duplicateTrade(userId: number, id: number): Trade | null {
  const t = getTrade(userId, id);
  if (!t) return null;
  const { executions, ...rest } = t;
  const data: TradeData = {
    ...rest,
    executions: executions?.map((e) => ({ role: e.role, price: e.price, quantity: e.quantity, executedAt: e.executedAt })) ?? null,
  };
  return createTrade(userId, data, { source: "manual" });
}

/** Soft delete so the UI can offer undo; purgeDeletedTrades removes them after 30 days. */
export function setTradesDeleted(userId: number, ids: number[], deleted: boolean): number {
  if (ids.length === 0) return 0;
  const res = db()
    .prepare(`UPDATE trades SET deleted_at = ? WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .run(deleted ? now() : null, userId, ...ids);
  audit(userId, deleted ? "trade.deleted" : "trade.restored", "trade", ids.join(","));
  purgeDeletedTrades(db());
  return Number(res.changes);
}

// ---------- imports ----------

export function existingSourceKeys(userId: number, accountId: number): Set<string> {
  const rows = db().prepare("SELECT source_key FROM trades WHERE user_id = ? AND account_id = ? AND source_key IS NOT NULL AND deleted_at IS NULL").all(userId, accountId) as { source_key: string }[];
  return new Set(rows.map((r) => r.source_key));
}

export interface ImportRecord {
  filename: string;
  fileSha256: string;
  storedName: string | null;
  format: string;
  adapter: string;
  options: unknown;
  totalRows: number;
  duplicates: number;
  invalid: number;
  errors: unknown[];
}

/** All or nothing: a failure on any row leaves no trades and no batch behind. */
export function importTrades(userId: number, accountId: number, rows: { trade: TradeData; sourceKey: string }[], record: ImportRecord): { batch: string; count: number } {
  const batch = randomUUID();
  transaction(db(), () => {
    db()
      .prepare(`INSERT INTO import_batches (id, user_id, account_id, filename, file_sha256, stored_name, format, adapter, options, total_rows, imported, duplicates, invalid, errors, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(batch, userId, accountId, record.filename, record.fileSha256, record.storedName, record.format, record.adapter, JSON.stringify(record.options), record.totalRows, rows.length, record.duplicates, record.invalid, JSON.stringify(record.errors), now());
    for (const r of rows) insertTrade(userId, r.trade, { source: "csv", importBatch: batch, sourceKey: r.sourceKey });
    audit(userId, "import.committed", "import_batch", batch, { rows: rows.length, duplicates: record.duplicates, invalid: record.invalid, format: record.format });
  });
  return { batch, count: rows.length };
}

export function undoImport(userId: number, batch: string): number {
  return transaction(db(), () => {
    const removed = Number(db().prepare("DELETE FROM trades WHERE import_batch = ? AND user_id = ?").run(batch, userId).changes);
    db().prepare("UPDATE import_batches SET status = 'undone' WHERE id = ? AND user_id = ?").run(batch, userId);
    audit(userId, "import.undone", "import_batch", batch, { removed });
    return removed;
  });
}

export function listImports(userId: number) {
  return db().prepare("SELECT id, account_id, filename, format, adapter, total_rows, imported, duplicates, invalid, status, created_at FROM import_batches WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId);
}

// ---------- reconciliation ----------

export interface ReconcilePair {
  a: Trade;
  b: Trade;
  reason: string;
}

/**
 * The same trade seen from two sources: same account, symbol, side and size, entry price
 * within a tick's worth, opened within a minute. Time alone never counts as a match.
 * Only ever suggests; the user decides.
 */
export function reconciliationCandidates(userId: number): ReconcilePair[] {
  const rows = db()
    .prepare(`SELECT a.id AS a_id, b.id AS b_id FROM trades a JOIN trades b
        ON b.account_id = a.account_id AND b.symbol = a.symbol AND b.side = a.side AND b.id > a.id AND b.source != a.source
       AND ABS(b.quantity - a.quantity) < 0.0000001 AND ABS(b.entry_price - a.entry_price) <= ABS(a.entry_price) * 0.00001
       AND ABS(julianday(b.opened_at) - julianday(a.opened_at)) * 86400 <= 60
       WHERE a.user_id = ? AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.source != 'sample' AND b.source != 'sample'
         AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.trade_a = a.id AND r.trade_b = b.id)
       LIMIT 100`)
    .all(userId) as { a_id: number; b_id: number }[];
  return rows.flatMap(({ a_id, b_id }) => {
    const [a, b] = [getTrade(userId, a_id), getTrade(userId, b_id)];
    return a && b ? [{ a, b, reason: `Same account, ${a.symbol} ${a.side}, size ${a.quantity}, near-identical entry, opened within a minute.` }] : [];
  });
}

/**
 * Keeps both records, or folds one into the other: the kept trade's numbers stay, and notes,
 * tags and psychology the other holds are copied only where the kept trade is empty.
 */
export function resolveReconciliation(userId: number, keepId: number, otherId: number, decision: "kept_both" | "merged"): boolean {
  const [keep, other] = [getTrade(userId, keepId), getTrade(userId, otherId)];
  if (!keep || !other) return false;
  const [a, b] = keepId < otherId ? [keepId, otherId] : [otherId, keepId];
  transaction(db(), () => {
    db().prepare("INSERT OR IGNORE INTO reconciliations (user_id, trade_a, trade_b, decision, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, a, b, decision, now());
    if (decision === "merged") {
      const conn = db();
      conn.prepare(`UPDATE trades SET
          notes = CASE WHEN notes = '' THEN ? ELSE notes END, plan_notes = CASE WHEN plan_notes = '' THEN ? ELSE plan_notes END,
          setup = CASE WHEN setup = '' THEN ? ELSE setup END, lessons = CASE WHEN lessons = '' THEN ? ELSE lessons END,
          entry_reason = CASE WHEN entry_reason = '' THEN ? ELSE entry_reason END, exit_reason = CASE WHEN exit_reason = '' THEN ? ELSE exit_reason END,
          grade = COALESCE(grade, ?), emotion_before = COALESCE(emotion_before, ?), emotion_after = COALESCE(emotion_after, ?), followed_plan = COALESCE(followed_plan, ?),
          stop_price = COALESCE(stop_price, ?), target_price = COALESCE(target_price, ?)
        WHERE id = ?`)
        .run(other.notes, other.planNotes, other.setup, other.lessons, other.entryReason, other.exitReason, other.grade, other.emotionBefore, other.emotionAfter, bool(other.followedPlan), other.stopPrice, other.targetPrice, keepId);
      conn.prepare("INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) SELECT ?, tag_id FROM trade_tags WHERE trade_id = ?").run(keepId, otherId);
      conn.prepare("UPDATE attachments SET trade_id = ? WHERE trade_id = ?").run(keepId, otherId);
      conn.prepare("UPDATE trades SET deleted_at = ? WHERE id = ?").run(now(), otherId);
      recalculateTrade(keepId);
    }
    audit(userId, "reconciliation.resolved", "trade", `${keepId},${otherId}`, { decision });
  });
  return true;
}

// ---------- whole-store operations ----------

export function exportAll(userId: number) {
  const conn = db();
  const byUser = (table: string) => conn.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId);
  const byAccount = (table: string) => conn.prepare(`SELECT x.* FROM ${table} x JOIN accounts a ON a.id = x.account_id WHERE a.user_id = ?`).all(userId);
  return {
    exportedAt: now(),
    format: "jarvis-export-v2",
    accounts: byUser("accounts"),
    // Includes trades awaiting purge (deleted_at set): the export claims to hold everything stored.
    trades: byUser("trades"),
    executions: byAccount("executions"),
    orders: byAccount("orders"),
    instruments: byAccount("instruments"),
    strategies: byUser("strategies"),
    tags: byUser("tags"),
    importBatches: byUser("import_batches"),
    attachments: conn.prepare("SELECT id, trade_id, kind, filename, mime, size, sha256, created_at FROM attachments WHERE user_id = ?").all(userId),
    // Only this user's settings row. MT5 connections are left out on purpose: they hold credentials.
    settings: conn.prepare("SELECT * FROM settings WHERE key = ?").all(`app:${userId}`),
    jarvisMemories: byUser("jarvis_memories"),
    jarvisConversations: byUser("jarvis_conversations"),
    jarvisMessages: conn.prepare("SELECT m.* FROM jarvis_messages m JOIN jarvis_conversations c ON c.id = m.conversation_id WHERE c.user_id = ?").all(userId),
    activityLog: byUser("activity_log"),
  };
}

function removeStoredFiles(folder: string, names: string[]) {
  for (const name of names) {
    try {
      unlinkSync(path.join(dataPath(folder), name));
    } catch {
      // Already gone: the row is what the app reads.
    }
  }
}

/** Removes this user's data; the login stays. Connected MT5 passwords go with their accounts. */
export function deleteAllData(userId: number) {
  const conn = db();
  const storedNames = (table: string) => (conn.prepare(`SELECT stored_name FROM ${table} WHERE user_id = ? AND stored_name IS NOT NULL`).all(userId) as { stored_name: string }[]).map((r) => r.stored_name);
  const [attachments, uploads] = [storedNames("attachments"), storedNames("import_batches")];
  const accountSettings = (conn.prepare("SELECT id FROM accounts WHERE user_id = ?").all(userId) as { id: number }[]).map((a) => `mt5:${a.id}`);
  transaction(conn, () => {
    for (const key of accountSettings) conn.prepare("DELETE FROM settings WHERE key = ?").run(key);
    for (const table of ["jarvis_conversations", "jarvis_memories", "activity_log", "import_batches", "attachments", "reconciliations", "trades", "tags", "strategies", "accounts"])
      conn.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    conn.prepare("DELETE FROM settings WHERE key = ?").run(`app:${userId}`);
    audit(userId, "data.deleted_all");
  });
  removeStoredFiles("attachments", attachments);
  removeStoredFiles("imports", uploads);
}

export function removeSampleData(userId: number): number {
  const conn = db();
  return transaction(conn, () => {
    const n = Number(conn.prepare("DELETE FROM trades WHERE source = 'sample' AND user_id = ?").run(userId).changes);
    conn.prepare("DELETE FROM accounts WHERE is_sample = 1 AND user_id = ? AND id NOT IN (SELECT account_id FROM trades)").run(userId);
    return n;
  });
}

export function hasSampleData(userId: number): boolean {
  return Boolean(db().prepare("SELECT 1 FROM trades WHERE source = 'sample' AND user_id = ? AND deleted_at IS NULL LIMIT 1").get(userId));
}
