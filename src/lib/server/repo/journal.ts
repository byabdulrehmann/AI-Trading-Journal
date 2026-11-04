import "server-only";
import { randomUUID } from "node:crypto";
import { db, now, purgeDeletedTrades, transaction } from "../db";
import type { Account, AccountInput, Trade, TradeData } from "@/lib/domain/types";
import { computePlannedR, computePnl, computeR } from "@/lib/domain/trade-math";

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
    createdAt: r.created_at as string,
  };
}

export function listAccounts(includeArchived = true): Account[] {
  const rows = db()
    .prepare(`SELECT * FROM accounts ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY archived, id`)
    .all() as Row[];
  return rows.map(toAccount);
}

export function getAccount(id: number): Account | null {
  const r = db().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Row | undefined;
  return r ? toAccount(r) : null;
}

export function createAccount(a: AccountInput, isSample = false): Account {
  const res = db()
    .prepare("INSERT INTO accounts (name, broker, currency, starting_balance, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(a.name, a.broker, a.currency, a.startingBalance, isSample ? 1 : 0, now());
  return getAccount(Number(res.lastInsertRowid)) as Account;
}

export function updateAccount(id: number, a: Partial<AccountInput> & { archived?: boolean }): Account | null {
  const cur = getAccount(id);
  if (!cur) return null;
  const next = { ...cur, ...a };
  db()
    .prepare("UPDATE accounts SET name = ?, broker = ?, currency = ?, starting_balance = ?, archived = ? WHERE id = ?")
    .run(next.name, next.broker, next.currency, next.startingBalance, next.archived ? 1 : 0, id);
  return getAccount(id);
}

export function ensureDefaultAccount(): Account {
  const existing = listAccounts(false)[0];
  if (existing) return existing;
  return createAccount({ name: "Main account", broker: "", currency: "USD", startingBalance: 10000 });
}

// ---------- trades ----------

function toTrade(r: Row): Trade {
  const data: TradeData = {
    accountId: r.account_id as number,
    symbol: r.symbol as string,
    side: r.side as "long" | "short",
    openedAt: r.opened_at as string,
    closedAt: (r.closed_at as string | null) ?? null,
    entryPrice: r.entry_price as number,
    exitPrice: (r.exit_price as number | null) ?? null,
    quantity: r.quantity as number,
    multiplier: r.multiplier as number,
    stopPrice: (r.stop_price as number | null) ?? null,
    targetPrice: (r.target_price as number | null) ?? null,
    fees: r.fees as number,
    setup: r.setup as string,
    tags: JSON.parse(r.tags as string),
    emotionBefore: (r.emotion_before as TradeData["emotionBefore"]) ?? null,
    emotionAfter: (r.emotion_after as TradeData["emotionAfter"]) ?? null,
    followedPlan: r.followed_plan === null ? null : r.followed_plan === 1,
    grade: (r.grade as TradeData["grade"]) ?? null,
    planNotes: r.plan_notes as string,
    notes: r.notes as string,
  };
  return {
    ...data,
    id: r.id as number,
    source: r.source as Trade["source"],
    importBatch: (r.import_batch as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    pnl: computePnl(data),
    rMultiple: computeR(data),
    plannedR: computePlannedR(data),
  };
}

export function listTrades(opts: { accountId?: number; includeDeleted?: boolean } = {}): Trade[] {
  const where: string[] = [];
  const args: (number | string)[] = [];
  if (!opts.includeDeleted) where.push("deleted_at IS NULL");
  if (opts.accountId) {
    where.push("account_id = ?");
    args.push(opts.accountId);
  }
  const rows = db()
    .prepare(`SELECT * FROM trades ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY opened_at DESC, id DESC`)
    .all(...args) as Row[];
  return rows.map(toTrade);
}

export function getTrade(id: number): Trade | null {
  const r = db().prepare("SELECT * FROM trades WHERE id = ? AND deleted_at IS NULL").get(id) as Row | undefined;
  return r ? toTrade(r) : null;
}

const COLS = [
  "account_id", "symbol", "side", "opened_at", "closed_at", "entry_price", "exit_price", "quantity", "multiplier",
  "stop_price", "target_price", "fees", "setup", "tags", "emotion_before", "emotion_after", "followed_plan", "grade",
  "plan_notes", "notes",
];

function values(t: TradeData) {
  return [
    t.accountId, t.symbol, t.side, new Date(t.openedAt).toISOString(),
    t.closedAt ? new Date(t.closedAt).toISOString() : null, t.entryPrice, t.exitPrice, t.quantity, t.multiplier,
    t.stopPrice, t.targetPrice, t.fees, t.setup, JSON.stringify(t.tags), t.emotionBefore, t.emotionAfter,
    t.followedPlan === null ? null : t.followedPlan ? 1 : 0, t.grade, t.planNotes, t.notes,
  ];
}

export function createTrade(t: TradeData, source: Trade["source"] = "manual", importBatch: string | null = null): Trade {
  const ts = now();
  const res = db()
    .prepare(
      `INSERT INTO trades (${COLS.join(", ")}, source, import_batch, created_at, updated_at)
       VALUES (${COLS.map(() => "?").join(", ")}, ?, ?, ?, ?)`,
    )
    .run(...values(t), source, importBatch, ts, ts);
  return getTrade(Number(res.lastInsertRowid)) as Trade;
}

export function updateTrade(id: number, t: TradeData): Trade | null {
  const res = db()
    .prepare(`UPDATE trades SET ${COLS.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(...values(t), now(), id);
  return res.changes ? getTrade(id) : null;
}

/** Soft delete so the UI can offer undo; purgeDeletedTrades removes them after 30 days. */
export function setTradesDeleted(ids: number[], deleted: boolean): number {
  if (ids.length === 0) return 0;
  const res = db()
    .prepare(`UPDATE trades SET deleted_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
    .run(deleted ? now() : null, ...ids);
  purgeDeletedTrades(db());
  return Number(res.changes);
}

export function importTrades(trades: TradeData[]): { batch: string; count: number } {
  const batch = randomUUID();
  transaction(db(), () => {
    for (const t of trades) createTrade(t, "csv", batch);
  });
  return { batch, count: trades.length };
}

export function undoImport(batch: string): number {
  return Number(db().prepare("DELETE FROM trades WHERE import_batch = ?").run(batch).changes);
}

// ---------- whole-store operations ----------

export function exportAll() {
  const conn = db();
  return {
    exportedAt: now(),
    format: "kestrel-export-v1",
    accounts: conn.prepare("SELECT * FROM accounts").all(),
    // Includes trades awaiting purge (deleted_at set): the export claims to hold everything stored.
    trades: conn.prepare("SELECT * FROM trades").all(),
    // Only the app settings row: other rows hold credentials (e.g. the TradBot-I pairing token).
    settings: conn.prepare("SELECT * FROM settings WHERE key = 'app'").all(),
    jarvisMemories: conn.prepare("SELECT * FROM jarvis_memories").all(),
    jarvisConversations: conn.prepare("SELECT * FROM jarvis_conversations").all(),
    jarvisMessages: conn.prepare("SELECT * FROM jarvis_messages").all(),
    activityLog: conn.prepare("SELECT * FROM activity_log").all(),
  };
}

export function deleteAllData() {
  const conn = db();
  transaction(conn, () => {
    for (const table of ["jarvis_messages", "jarvis_conversations", "jarvis_memories", "activity_log", "trades", "accounts", "settings"])
      conn.exec(`DELETE FROM ${table}`);
  });
}

export function removeSampleData(): number {
  const conn = db();
  return transaction(conn, () => {
    const n = Number(conn.prepare("DELETE FROM trades WHERE source = 'sample'").run().changes);
    conn.exec("DELETE FROM accounts WHERE is_sample = 1 AND id NOT IN (SELECT account_id FROM trades)");
    return n;
  });
}

export function hasSampleData(): boolean {
  return Boolean(db().prepare("SELECT 1 FROM trades WHERE source = 'sample' LIMIT 1").get());
}
