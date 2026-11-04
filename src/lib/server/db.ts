import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { migrateToJournalModel, JOURNAL_MODEL_SQL } from "./migrations/journal-model";

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
];

const globalForDb = globalThis as unknown as { __kestrelDb?: DatabaseSync };

const dbFile = () => process.env.KESTREL_DB_PATH || path.join(process.cwd(), "data", "kestrel.db");

/** A folder beside the database, for files that don't belong in it. */
export function dataPath(folder: string): string {
  const dir = path.join(path.dirname(dbFile()), folder);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function open(): DatabaseSync {
  const file = dbFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  migrate(db);
  purgeDeletedTrades(db);
  return db;
}

/** Deleted trades stay for undo, then go for good, notes included. */
export function purgeDeletedTrades(conn: DatabaseSync) {
  const expired = "SELECT id FROM trades WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')";
  const files = conn.prepare(`SELECT stored_name FROM attachments WHERE trade_id IN (${expired})`).all() as { stored_name: string }[];
  conn.exec(`DELETE FROM trades WHERE id IN (${expired})`);
  for (const f of files) {
    try {
      unlinkSync(path.join(dataPath("attachments"), f.stored_name));
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
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
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
