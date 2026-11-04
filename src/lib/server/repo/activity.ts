import "server-only";
import { db, now } from "../db";
import { getSettings } from "./settings";
import type { ActivityEvent } from "@/lib/domain/types";

/** Writes only when the user has opted in to activity tracking. */
export function recordActivity(userId: number, type: string, detail: Record<string, unknown> = {}) {
  if (!getSettings(userId).activityTracking) return;
  db().prepare("INSERT INTO activity_log (user_id, type, detail, created_at) VALUES (?, ?, ?, ?)").run(userId, type, JSON.stringify(detail), now());
}

export function listActivity(userId: number, limit = 200): ActivityEvent[] {
  const rows = db()
    .prepare("SELECT id, type, detail, created_at FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit) as { id: number; type: string; detail: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, type: r.type, detail: JSON.parse(r.detail), createdAt: r.created_at }));
}

export function clearActivity(userId: number): number {
  return Number(db().prepare("DELETE FROM activity_log WHERE user_id = ?").run(userId).changes);
}
