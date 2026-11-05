import "server-only";
import { listSchedulable } from "../repo/mt5";
import { syncAccount } from "./sync";

const TICK_MS = 5_000;
const MAX_BACKOFF_SECONDS = 3600;

const g = globalThis as unknown as { __jarvisMt5Scheduler?: { timer: NodeJS.Timeout; running: boolean; failures: Map<number, number> } };

/** Pure, for testing: after n failures in a row, wait interval x 2^n, capped at an hour. */
export function nextDueMs(lastAttemptAt: string | null, intervalSeconds: number, failures: number): number {
  if (!lastAttemptAt) return 0;
  const wait = Math.min(intervalSeconds * 2 ** failures, Math.max(MAX_BACKOFF_SECONDS, intervalSeconds));
  return Date.parse(lastAttemptAt) + wait * 1000;
}

/** Idempotent: one timer per server process, through hot reloads too. */
export function startMt5Scheduler() {
  if (g.__jarvisMt5Scheduler) return;
  const s = { running: false, failures: new Map<number, number>(), timer: setInterval(() => void tick(), TICK_MS) };
  s.timer.unref();
  g.__jarvisMt5Scheduler = s;

  async function tick() {
    if (s.running) return; // Sequential: never two runs at once.
    s.running = true;
    try {
      for (const c of listSchedulable()) {
        if (Date.now() < nextDueMs(c.last_attempt_at, c.sync_interval_seconds, s.failures.get(c.account_id) ?? 0)) continue;
        const r = await syncAccount(c.account_id);
        if (r.ok) s.failures.delete(c.account_id);
        else s.failures.set(c.account_id, (s.failures.get(c.account_id) ?? 0) + 1);
      }
    } catch {
      // The database was busy or closing: the next tick tries again.
    } finally {
      s.running = false;
    }
  }
}
