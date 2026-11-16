import "server-only";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BACKUP_KEYS, changeBackupPassword, makeBackupKeys, readBackupKeys, rewrap, sealFile, unseal } from "./backup-seal";
import { dataPath, db } from "./db";
import { audit } from "./repo/audit";

/**
 * Whole-database copies in the data folder's backups folder. They hold every user's journal, so only the
 * owner sees them. Stored MT5 passwords stay encrypted in them; the key lives outside the database.
 */
export interface Backup {
  name: string;
  size: number;
  createdAt: string;
  kind: "manual" | "auto" | "migration";
  /** Locked with the backup password (".db.sealed"); a plain database file otherwise. */
  encrypted: boolean;
}

const NAME = /^kestrel-[A-Za-z0-9-]+\.db(\.sealed)?$/;
const KEEP_AUTO = 7;
const DAY_MS = 24 * 3600_000;

const dir = () => dataPath("backups");
const kindOf = (name: string): Backup["kind"] => (name.startsWith("kestrel-auto-") ? "auto" : name.startsWith("kestrel-before-migration-") ? "migration" : "manual");

export function listBackups(): Backup[] {
  return readdirSync(dir())
    .filter((n) => NAME.test(n))
    .map((name) => {
      const s = statSync(path.join(/*turbopackIgnore: true*/ dir(), name));
      return { name, size: s.size, createdAt: s.mtime.toISOString(), kind: kindOf(name), encrypted: name.endsWith(".sealed") };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createBackup(kind: "manual" | "auto"): Backup {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `kestrel-${kind === "auto" ? "auto" : "backup"}-${stamp}.db`;
  const file = path.join(/*turbopackIgnore: true*/ dir(), name);
  // A consistent copy even while the app writes: SQLite takes it inside one read transaction.
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const kept = path.basename(sealFile(db(), file));
  if (kind === "auto") for (const old of listBackups().filter((b) => b.kind === "auto").slice(KEEP_AUTO)) unlinkSync(path.join(/*turbopackIgnore: true*/ dir(), old.name));
  return listBackups().find((b) => b.name === kept)!;
}

/** Whether backups are being encrypted, that is, whether the owner set a backup password. */
export const backupsLocked = () => readBackupKeys(db()) !== null;

/**
 * Sets the backup password, or changes it (the current one is required; every backup then opens with the new one). `reset` starts over with new keys when the
 * password is lost: backups made before stay locked to the old one. Every plain backup is encrypted straight away.
 */
export function setBackupPassword(userId: number, next: string, opts: { current?: string; reset?: boolean } = {}): "ok" | "wrong" {
  const existing = readBackupKeys(db());
  const keys = existing && !opts.reset ? changeBackupPassword(existing, opts.current ?? "", next) : makeBackupKeys(next);
  if (!keys) return "wrong";
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(BACKUP_KEYS, JSON.stringify(keys));
  for (const b of listBackups()) {
    const file = path.join(/*turbopackIgnore: true*/ dir(), b.name);
    if (!b.encrypted) sealFile(db(), file);
    // A changed password opens the backups made before too. After a reset they stay with the old keys.
    else if (existing && !opts.reset) writeFileSync(file, rewrap(readFileSync(file), keys));
  }
  audit(userId, existing ? (opts.reset ? "backup_password.reset" : "backup_password.changed") : "backup_password.set");
  return "ok";
}

/** A backup as a plain database file: decrypted with the password when it's encrypted. Null when the password is wrong. */
export function readBackupPlain(name: string, password: string): Buffer | null | undefined {
  const file = backupPath(name);
  if (!file) return undefined;
  const bytes = readFileSync(file);
  return name.endsWith(".sealed") ? unseal(bytes, password) : bytes;
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
