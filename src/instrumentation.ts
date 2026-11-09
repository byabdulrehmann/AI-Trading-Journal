/** Starts MT5 sync and daily backups with the server. Sync only ever acts on connections the user has stored. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("@/lib/server/mt5/scheduler")).startMt5Scheduler();
  (await import("@/lib/server/backup")).startBackupScheduler();
}
