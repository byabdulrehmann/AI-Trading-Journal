import "server-only";
import { db, now } from "../db";
import type { DailyEntry, DailyInput } from "@/lib/domain/types";

type Row = { date: string; plan: string; recap: string; rating: number | null; is_sample: number; updated_at: string };

const toEntry = (r: Row): DailyEntry => ({ date: r.date, plan: r.plan, recap: r.recap, rating: r.rating, isSample: r.is_sample === 1, updatedAt: r.updated_at });

/** Sample notes stay out unless asked for, like sample trades. */
export function getDay(userId: number, date: string, includeSample: boolean): DailyEntry | null {
  const r = db().prepare(`SELECT * FROM daily_journal WHERE user_id = ? AND date = ?${includeSample ? "" : " AND is_sample = 0"}`).get(userId, date) as Row | undefined;
  return r ? toEntry(r) : null;
}

export function listDays(userId: number, includeSample: boolean): DailyEntry[] {
  const rows = db().prepare(`SELECT * FROM daily_journal WHERE user_id = ?${includeSample ? "" : " AND is_sample = 0"} ORDER BY date DESC`).all(userId) as Row[];
  return rows.map(toEntry);
}

/** An entry with nothing left in it goes away. Writing on a sample day makes it the user's own. */
export function saveDay(userId: number, d: DailyInput): DailyEntry | null {
  const conn = db();
  if (!d.plan.trim() && !d.recap.trim() && d.rating === null) {
    conn.prepare("DELETE FROM daily_journal WHERE user_id = ? AND date = ?").run(userId, d.date);
    return null;
  }
  conn
    .prepare(`INSERT INTO daily_journal (user_id, date, plan, recap, rating, is_sample, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET plan = excluded.plan, recap = excluded.recap, rating = excluded.rating, is_sample = 0, updated_at = excluded.updated_at`)
    .run(userId, d.date, d.plan, d.recap, d.rating, now());
  return getDay(userId, d.date, false);
}

/** Never over a day the user wrote. */
export function insertSampleDays(userId: number, days: DailyInput[]) {
  const insert = db().prepare("INSERT OR IGNORE INTO daily_journal (user_id, date, plan, recap, rating, is_sample, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)");
  for (const d of days) insert.run(userId, d.date, d.plan, d.recap, d.rating, now());
}
