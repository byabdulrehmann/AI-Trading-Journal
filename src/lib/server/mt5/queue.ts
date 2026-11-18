import "server-only";
import { syncAccount, type SyncOutcome } from "./sync";

/**
 * The one MT5 terminal signs in to one account at a time, so every sync, scheduled or asked for, waits its turn here.
 * Turns go round the users: someone with five accounts doesn't keep someone with one waiting behind five syncs.
 */

interface Job {
  accountId: number;
  userId: number;
  done: Promise<SyncOutcome>;
  resolve: (o: SyncOutcome) => void;
}

const g = globalThis as unknown as { __jarvisMt5Queue?: { waiting: Job[]; running: Job | null; served: Map<number, number>; turn: number } };
g.__jarvisMt5Queue ??= { waiting: [], running: null, served: new Map(), turn: 0 };
const q = g.__jarvisMt5Queue;

/** Pure, for testing: the next job's index. The user served longest ago goes first, and their oldest job. */
export function pickNext(waiting: { userId: number }[], served: Map<number, number>): number {
  let best = 0;
  for (let i = 1; i < waiting.length; i++) if ((served.get(waiting[i].userId) ?? 0) < (served.get(waiting[best].userId) ?? 0)) best = i;
  return best;
}

/** Whether a sync of this account is waiting or running. */
export const isQueued = (accountId: number) => q.running?.accountId === accountId || q.waiting.some((j) => j.accountId === accountId);

/** Queues a sync and resolves when it has run. An account already in the queue isn't queued twice: this joins it. */
export function queueSync(accountId: number, userId: number): Promise<SyncOutcome> {
  const existing = q.running?.accountId === accountId ? q.running : q.waiting.find((j) => j.accountId === accountId);
  if (existing) return existing.done;
  let resolve!: (o: SyncOutcome) => void;
  const job: Job = { accountId, userId, done: new Promise((r) => (resolve = r)), resolve };
  q.waiting.push(job);
  void work();
  return job.done;
}

async function work() {
  if (q.running) return;
  while (q.waiting.length) {
    const job = q.waiting.splice(pickNext(q.waiting, q.served), 1)[0];
    q.running = job;
    q.served.set(job.userId, ++q.turn);
    let outcome: SyncOutcome;
    try {
      outcome = await syncAccount(job.accountId);
    } catch {
      outcome = { ok: false, category: "other", error: "The sync failed. It will try again." };
    }
    q.running = null;
    job.resolve(outcome);
  }
}
