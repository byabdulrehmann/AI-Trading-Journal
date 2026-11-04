import type { DatabaseSync } from "node:sqlite";
import { classifySymbol, sessionFor } from "../../domain/engine/instruments";
import { computePosition } from "../../domain/engine/position";

/**
 * Migration 2. Only adds to the schema: every existing row is kept. The old `fees` and
 * `tags` columns stay in place so a downgrade still has the original values.
 * Rows keep user_id NULL until the first account is created and adopts them.
 */
export const JOURNAL_MODEL_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_owner INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE accounts ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
  CREATE INDEX accounts_user ON accounts(user_id);

  CREATE TABLE strategies (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (user_id, name)
  );

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom', 'strategy')),
    UNIQUE (user_id, name, kind)
  );

  CREATE TABLE trade_tags (
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (trade_id, tag_id)
  );

  /* One row per account and symbol, because contract specs differ by broker. */
  CREATE TABLE instruments (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    asset_class TEXT NOT NULL DEFAULT 'other',
    contract_size REAL,
    digits INTEGER,
    point REAL,
    tick_size REAL,
    tick_value REAL,
    pip_size REAL,
    base_currency TEXT,
    quote_currency TEXT,
    profit_currency TEXT,
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'mt5')),
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, symbol)
  );

  ALTER TABLE trades ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE trades ADD COLUMN strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL;
  ALTER TABLE trades ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'other';
  ALTER TABLE trades ADD COLUMN session TEXT;
  ALTER TABLE trades ADD COLUMN commission REAL NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN swap REAL NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN other_fees REAL NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN fx_rate REAL;
  ALTER TABLE trades ADD COLUMN broker_profit REAL;
  ALTER TABLE trades ADD COLUMN broker_position_id TEXT;
  ALTER TABLE trades ADD COLUMN source_key TEXT;
  ALTER TABLE trades ADD COLUMN entry_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE trades ADD COLUMN exit_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE trades ADD COLUMN lessons TEXT NOT NULL DEFAULT '';
  ALTER TABLE trades ADD COLUMN mistakes TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE trades ADD COLUMN confidence INTEGER;
  ALTER TABLE trades ADD COLUMN discipline INTEGER;
  ALTER TABLE trades ADD COLUMN fear INTEGER;
  ALTER TABLE trades ADD COLUMN greed INTEGER;
  ALTER TABLE trades ADD COLUMN revenge_trade INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN overtrading INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN impulsive_entry INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN early_exit INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN rule_violations TEXT NOT NULL DEFAULT '';
  /* Results of the calculation engine, stored so lists can sort and page in SQL. */
  ALTER TABLE trades ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'closed'));
  ALTER TABLE trades ADD COLUMN pnl_status TEXT NOT NULL DEFAULT 'ok';
  ALTER TABLE trades ADD COLUMN remaining_qty REAL NOT NULL DEFAULT 0;
  ALTER TABLE trades ADD COLUMN gross_pnl REAL;
  ALTER TABLE trades ADD COLUMN net_pnl REAL;
  ALTER TABLE trades ADD COLUMN risk_amount REAL;
  ALTER TABLE trades ADD COLUMN r_multiple REAL;
  ALTER TABLE trades ADD COLUMN planned_r REAL;
  ALTER TABLE trades ADD COLUMN holding_minutes REAL;
  CREATE INDEX trades_user_opened ON trades(user_id, deleted_at, opened_at);
  CREATE INDEX trades_user_closed ON trades(user_id, deleted_at, closed_at);
  CREATE INDEX trades_user_symbol ON trades(user_id, symbol);
  CREATE INDEX trades_batch ON trades(import_batch);
  CREATE UNIQUE INDEX trades_source_key ON trades(account_id, source, source_key) WHERE source_key IS NOT NULL;

  /* Fills. A journal trade groups these; one MT5 deal is never a trade by itself. */
  CREATE TABLE executions (
    id INTEGER PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('entry', 'exit')),
    price REAL NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    executed_at TEXT NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    profit REAL,
    source TEXT NOT NULL DEFAULT 'manual',
    broker_deal_id TEXT,
    broker_order_id TEXT,
    broker_position_id TEXT,
    raw TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX executions_trade ON executions(trade_id, executed_at);
  CREATE UNIQUE INDEX executions_deal ON executions(account_id, broker_deal_id) WHERE broker_deal_id IS NOT NULL;

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    broker_order_id TEXT NOT NULL,
    broker_position_id TEXT,
    symbol TEXT NOT NULL,
    type INTEGER,
    state INTEGER,
    volume_initial REAL,
    volume_current REAL,
    price_open REAL,
    stop_loss REAL,
    take_profit REAL,
    time_setup TEXT,
    time_done TEXT,
    raw TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (account_id, broker_order_id)
  );
  CREATE INDEX orders_position ON orders(account_id, broker_position_id);

  /* What the broker reported as open at the last sync. Replaced on each sync. */
  CREATE TABLE open_positions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    broker_position_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    price_open REAL NOT NULL,
    price_current REAL,
    stop_loss REAL,
    take_profit REAL,
    swap REAL,
    profit REAL,
    opened_at TEXT,
    synced_at TEXT NOT NULL,
    UNIQUE (account_id, broker_position_id)
  );

  CREATE TABLE mt5_connections (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    login TEXT NOT NULL,
    server TEXT NOT NULL,
    password_cipher TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    sync_interval_seconds INTEGER NOT NULL DEFAULT 60,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    history_synced_to TEXT,
    balance REAL,
    equity REAL,
    margin REAL,
    margin_free REAL,
    margin_level REAL,
    floating_pnl REAL,
    leverage INTEGER,
    currency TEXT,
    broker TEXT,
    margin_mode INTEGER,
    snapshot_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sync_jobs (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    deals_seen INTEGER NOT NULL DEFAULT 0,
    deals_new INTEGER NOT NULL DEFAULT 0,
    trades_created INTEGER NOT NULL DEFAULT 0,
    trades_updated INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE INDEX sync_jobs_account ON sync_jobs(account_id, id);

  CREATE TABLE import_batches (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    stored_name TEXT,
    format TEXT NOT NULL,
    adapter TEXT NOT NULL DEFAULT 'generic',
    options TEXT NOT NULL DEFAULT '{}',
    total_rows INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    duplicates INTEGER NOT NULL DEFAULT 0,
    invalid INTEGER NOT NULL DEFAULT 0,
    errors TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'committed',
    created_at TEXT NOT NULL
  );
  CREATE INDEX import_batches_user ON import_batches(user_id, created_at);

  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('entry', 'exit', 'chart', 'document')),
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX attachments_trade ON attachments(trade_id);

  /* Pairs the user has looked at, so a resolved possible duplicate isn't raised again. */
  CREATE TABLE reconciliations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    trade_a INTEGER NOT NULL,
    trade_b INTEGER NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('kept_both', 'merged')),
    created_at TEXT NOT NULL,
    UNIQUE (trade_a, trade_b)
  );

  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX audit_events_user ON audit_events(user_id, id);

  ALTER TABLE jarvis_memories ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE jarvis_conversations ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  ALTER TABLE activity_log ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
`;

type Row = Record<string, unknown>;

/** Gives every existing trade its fills, tags and engine results. Values aren't changed, only derived. */
export function migrateToJournalModel(db: DatabaseSync) {
  const now = new Date().toISOString();
  const trades = db
    .prepare("SELECT t.*, a.currency AS account_currency FROM trades t JOIN accounts a ON a.id = t.account_id")
    .all() as Row[];
  const addExecution = db.prepare(
    "INSERT INTO executions (trade_id, account_id, role, price, quantity, executed_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const update = db.prepare(`UPDATE trades SET commission = ?, asset_class = ?, session = ?, status = ?, pnl_status = ?, remaining_qty = ?,
    gross_pnl = ?, net_pnl = ?, risk_amount = ?, r_multiple = ?, planned_r = ?, holding_minutes = ? WHERE id = ?`);
  const findTag = db.prepare("SELECT id FROM tags WHERE user_id IS NULL AND name = ? AND kind = 'custom'");
  const insertTag = db.prepare("INSERT INTO tags (user_id, name, kind) VALUES (NULL, ?, 'custom')");
  const linkTag = db.prepare("INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)");

  for (const t of trades) {
    const exit = t.exit_price as number | null;
    const closedAt = t.closed_at as string | null;
    const openedAt = t.opened_at as string;
    const [price, qty] = [t.entry_price as number, t.quantity as number];
    addExecution.run(t.id as number, t.account_id as number, "entry", price, qty, openedAt, t.source as string, now);
    if (exit !== null && closedAt) addExecution.run(t.id as number, t.account_id as number, "exit", exit, qty, closedAt, t.source as string, now);

    const r = computePosition({
      side: t.side as "long" | "short",
      symbol: t.symbol as string,
      accountCurrency: t.account_currency as string,
      contractSize: t.multiplier as number,
      entries: [{ price, qty }],
      exits: exit !== null && closedAt ? [{ price: exit, qty }] : [],
      commission: t.fees as number,
      stopPrice: t.stop_price as number | null,
      targetPrice: t.target_price as number | null,
    });
    update.run(
      t.fees as number,
      classifySymbol(t.symbol as string),
      sessionFor(openedAt),
      r.status,
      r.pnlStatus,
      r.remainingQty,
      r.grossPnl,
      r.netPnl,
      r.initialRisk,
      r.rMultiple,
      r.plannedR,
      closedAt ? (Date.parse(closedAt) - Date.parse(openedAt)) / 60000 : null,
      t.id as number,
    );

    for (const name of JSON.parse(t.tags as string) as string[]) {
      const existing = findTag.get(name) as { id: number } | undefined;
      const tagId = existing ? existing.id : Number(insertTag.run(name).lastInsertRowid);
      linkTag.run(t.id as number, tagId);
    }
  }
}
