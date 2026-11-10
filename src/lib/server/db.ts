import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { migrateToJournalModel, JOURNAL_MODEL_SQL } from "./migrations/journal-model";
import { zoneParts } from "../domain/zone";

/**
 * Local SQLite store (Node's built-in node:sqlite).
 * Schema changes are append-only migrations; `schema_migrations` records which ran.
 */
export const MIGRATIONS: { version: number; name: string; sql: string; run?: (db: DatabaseSync) => void }[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        broker TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'USD',
        starting_balance REAL NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        is_sample INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE trades (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('long','short')),
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        entry_price REAL NOT NULL,
        exit_price REAL,
        quantity REAL NOT NULL,
        multiplier REAL NOT NULL DEFAULT 1,
        stop_price REAL,
        target_price REAL,
        fees REAL NOT NULL DEFAULT 0,
        setup TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        emotion_before TEXT,
        emotion_after TEXT,
        followed_plan INTEGER,
        grade TEXT,
        plan_notes TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        import_batch TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX trades_account ON trades(account_id);
      CREATE INDEX trades_opened ON trades(opened_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE jarvis_memories (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        evidence_trade_ids TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE jarvis_conversations (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE jarvis_messages (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES jarvis_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX jarvis_messages_conv ON jarvis_messages(conversation_id);

      CREATE TABLE activity_log (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `,
  },
  { version: 2, name: "journal model: users, executions, instruments, MT5, imports, attachments", sql: JOURNAL_MODEL_SQL, run: migrateToJournalModel },
  { version: 3, name: "index for finding the same trade across sources", sql: "CREATE INDEX trades_reconcile ON trades(account_id, symbol, side, opened_at);" },
  {
    version: 4,
    name: "option details on trades",
    sql: "ALTER TABLE trades ADD COLUMN option_right TEXT; ALTER TABLE trades ADD COLUMN strike REAL; ALTER TABLE trades ADD COLUMN expiry TEXT;",
  },
  {
    version: 5,
    name: "daily journal",
    sql: `CREATE TABLE daily_journal (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT '',
      recap TEXT NOT NULL DEFAULT '',
      rating INTEGER,
      is_sample INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, date)
    );`,
  },
  {
    version: 6,
    name: "playbook rules, trade checklists and missed trades",
    sql: `ALTER TABLE strategies ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE strategy_rules (
      id INTEGER PRIMARY KEY,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      group_name TEXT NOT NULL,
      text TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX strategy_rules_strategy ON strategy_rules(strategy_id);
    CREATE TABLE trade_rule_checks (
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      rule_id INTEGER NOT NULL REFERENCES strategy_rules(id) ON DELETE CASCADE,
      checked INTEGER NOT NULL,
      PRIMARY KEY (trade_id, rule_id)
    );
    CREATE INDEX trade_rule_checks_rule ON trade_rule_checks(rule_id);
    CREATE TABLE missed_trades (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      at TEXT NOT NULL,
      entry_price REAL NOT NULL,
      stop_price REAL,
      exit_price REAL,
      reason TEXT NOT NULL DEFAULT '',
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX missed_trades_user ON missed_trades(user_id);`,
  },
  {
    version: 7,
    name: "notebook",
    sql: `CREATE TABLE note_folders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES note_folders(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      is_sample INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX notes_user ON notes(user_id, updated_at);
    CREATE TABLE note_versions (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX note_versions_note ON note_versions(note_id);
    CREATE TABLE note_links (
      id INTEGER PRIMARY KEY,
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      trade_id INTEGER REFERENCES trades(id) ON DELETE CASCADE,
      day TEXT
    );
    CREATE UNIQUE INDEX note_links_trade ON note_links(note_id, trade_id) WHERE trade_id IS NOT NULL;
    CREATE UNIQUE INDEX note_links_day ON note_links(note_id, day) WHERE day IS NOT NULL;
    CREATE INDEX note_links_by_trade ON note_links(trade_id);
    CREATE INDEX note_links_by_day ON note_links(day);
    CREATE TABLE note_templates (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    );`,
  },
  {
    version: 8,
    name: "price bars and excursions",
    sql: `CREATE TABLE market_bars (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      PRIMARY KEY (account_id, symbol, timeframe, time)
    ) WITHOUT ROWID;
    CREATE TABLE bar_fetches (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      from_time INTEGER NOT NULL,
      to_time INTEGER NOT NULL
    );
    CREATE INDEX bar_fetches_lookup ON bar_fetches(account_id, symbol, timeframe);
    ALTER TABLE trades ADD COLUMN mae REAL;
    ALTER TABLE trades ADD COLUMN mfe REAL;
    ALTER TABLE trades ADD COLUMN excursion_note TEXT;`,
  },
  {
    version: 9,
    name: "backtesting sessions",
    sql: `CREATE TABLE backtest_sessions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      price_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      cursor_time INTEGER NOT NULL,
      strategy TEXT NOT NULL DEFAULT '',
      simulated INTEGER NOT NULL DEFAULT 0,
      seed INTEGER NOT NULL DEFAULT 1,
      anchor_price REAL,
      is_sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX backtest_sessions_user ON backtest_sessions(user_id);`,
  },
  {
    version: 10,
    name: "prop challenges, spending, routine and goals",
    sql: `CREATE TABLE challenges (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      firm TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      account_size REAL NOT NULL,
      profit_target REAL,
      daily_loss REAL,
      max_loss REAL,
      max_loss_type TEXT NOT NULL DEFAULT 'static',
      min_days INTEGER NOT NULL DEFAULT 0,
      consistency_pct REAL,
      reset_zone TEXT NOT NULL DEFAULT '',
      reset_hour INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX challenges_user ON challenges(user_id);
    CREATE TABLE prop_expenses (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
      firm TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX prop_expenses_user ON prop_expenses(user_id);
    CREATE TABLE routine_items (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      from_date TEXT NOT NULL,
      archived_date TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE routine_checks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      item_id INTEGER NOT NULL REFERENCES routine_items(id) ON DELETE CASCADE,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, date, item_id)
    );
    CREATE TABLE goals (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      period TEXT NOT NULL,
      target REAL NOT NULL,
      currency TEXT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );`,
  },
  {
    version: 11,
    name: "economic calendar, auto-tag rules and saved reviews",
    sql: `CREATE TABLE economic_events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      title TEXT NOT NULL,
      impact TEXT NOT NULL,
      actual TEXT NOT NULL DEFAULT '',
      forecast TEXT NOT NULL DEFAULT '',
      previous TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      UNIQUE (user_id, at, currency, title)
    );
    CREATE INDEX economic_events_at ON economic_events(user_id, at);
    CREATE TABLE tag_rules (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      conditions TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE tag_rule_hits (
      rule_id INTEGER NOT NULL REFERENCES tag_rules(id) ON DELETE CASCADE,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      PRIMARY KEY (rule_id, trade_id)
    );
    CREATE TABLE ai_reviews (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      start_date TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      shared TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, period, start_date)
    );`,
  },
  {
    version: 12,
    name: "early-access requests from the public website",
    // Not tied to a user: they come from signed-out visitors. Only the owner reads them.
    sql: `CREATE TABLE early_access (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      trades TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX early_access_created ON early_access(created_at);`,
  },
];

const globalForDb = globalThis as unknown as { __kestrelDb?: DatabaseSync };

const dbFile = () => process.env.KESTREL_DB_PATH || path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "kestrel.db");

/** A folder beside the database, for files that don't belong in it. */
export function dataPath(folder: string): string {
  // Untraced like the MT5 client paths: data/ holds the database, backups and the terminal, none of which ships.
  const dir = path.join(/*turbopackIgnore: true*/ path.dirname(dbFile()), folder);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function open(): DatabaseSync {
  const file = dbFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA secure_delete = ON;");
  db.function("zone_part", { deterministic: true }, (iso, tz, part) => {
    const p = zoneParts(Date.parse(String(iso)), String(tz) || undefined);
    return part === "weekday" ? p.weekday : p.hour;
  });
  migrate(db);
  purgeDeletedTrades(db);
  return db;
}

/** Deleted trades stay for undo, then go for good, notes included. */
export function purgeDeletedTrades(conn: DatabaseSync) {
  conn.exec("DELETE FROM notes WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')");
  const expired = "SELECT id FROM trades WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')";
  const files = conn.prepare(`SELECT stored_name FROM attachments WHERE trade_id IN (${expired})`).all() as { stored_name: string }[];
  conn.exec(`DELETE FROM trades WHERE id IN (${expired})`);
  for (const f of files) {
    try {
      unlinkSync(path.join(/*turbopackIgnore: true*/ dataPath("attachments"), f.stored_name));
    } catch {
      // Already gone: the row was what the app read.
    }
  }
}

function migrate(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  if (pending.length && applied.size) backupBeforeMigrating(db, pending[0].version);
  for (const m of pending) {
    transaction(db, () => {
      db.exec(m.sql);
      m.run?.(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
  }
}

/** A full copy of the existing journal, taken before its schema changes. */
function backupBeforeMigrating(db: DatabaseSync, version: number) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(/*turbopackIgnore: true*/ dataPath("backups"), `kestrel-before-migration-${version}-${stamp}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/** One connection per server process; reused across hot reloads in dev. */
export function db(): DatabaseSync {
  globalForDb.__kestrelDb ??= open();
  return globalForDb.__kestrelDb;
}

export function transaction<T>(conn: DatabaseSync, fn: () => T): T {
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export const now = () => new Date().toISOString();
