import "server-only";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { dataPath, db } from "./db";

/**
 * Whole-database copies in the data folder's backups folder. They hold every user's journal, so only the
 * owner sees them. Stored MT5 passwords stay encrypted in them; the key lives outside the database.
 */
export interface Backup {
  name: string;
  size: number;
  createdAt: string;
  kind: "manual" | "auto" | "migration";
}

const NAME = /^kestrel-[A-Za-z0-9-]+\.db$/;
const KEEP_AUTO = 7;
const DAY_MS = 24 * 3600_000;

const dir = () => dataPath("backups");
const kindOf = (name: string): Backup["kind"] => (name.startsWith("kestrel-auto-") ? "auto" : name.startsWith("kestrel-before-migration-") ? "migration" : "manual");

export function listBackups(): Backup[] {
  return readdirSync(dir())
    .filter((n) => NAME.test(n))
    .map((name) => {
      const s = statSync(path.join(/*turbopackIgnore: true*/ dir(), name));
      return { name, size: s.size, createdAt: s.mtime.toISOString(), kind: kindOf(name) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createBackup(kind: "manual" | "auto"): Backup {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `kestrel-${kind === "auto" ? "auto" : "backup"}-${stamp}.db`;
  // A consistent copy even while the app writes: SQLite takes it inside one read transaction.
  db().exec(`VACUUM INTO '${path.join(/*turbopackIgnore: true*/ dir(), name).replace(/'/g, "''")}'`);
  if (kind === "auto") for (const old of listBackups().filter((b) => b.kind === "auto").slice(KEEP_AUTO)) unlinkSync(path.join(/*turbopackIgnore: true*/ dir(), old.name));
  return listBackups().find((b) => b.name === name)!;
}

/** The file's full path, only for a name that is one of the backups. Anything else (a path, "..") is null. */
export function backupPath(name: string): string | null {
  return NAME.test(name) && listBackups().some((b) => b.name === name) ? path.join(/*turbopackIgnore: true*/ dir(), name) : null;
}

export function deleteBackup(name: string): boolean {
  const file = backupPath(name);
  if (!file) return false;
  unlinkSync(file);
  return true;
}

/** One automatic copy a day, the last seven kept. */
export function autoBackupIfDue(nowMs = Date.now()): Backup | null {
  const last = listBackups().find((b) => b.kind === "auto");
  return last && nowMs - Date.parse(last.createdAt) < DAY_MS ? null : createBackup("auto");
}

const g = globalThis as unknown as { __jarvisBackupTimer?: NodeJS.Timeout };

/** Idempotent: one hourly check per server process. */
export function startBackupScheduler() {
  if (g.__jarvisBackupTimer) return;
  const run = () => {
    try {
      autoBackupIfDue();
    } catch (err) {
      // A full disk or a locked folder: say so in the server log, and try again next hour.
      console.error("Automatic backup failed:", err instanceof Error ? err.message : err);
    }
  };
  setTimeout(run, 60_000).unref();
  g.__jarvisBackupTimer = setInterval(run, 3600_000);
  g.__jarvisBackupTimer.unref();
}
