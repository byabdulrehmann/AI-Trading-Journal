import "server-only";
import { db, now } from "../db";
import { getSettings } from "./settings";
import type { ActivityEvent } from "@/lib/domain/types";

/** Writes only when the user has opted in to activity tracking. */
export function recordActivity(type: string, detail: Record<string, unknown> = {}) {
  if (!getSettings().activityTracking) return;
  db().prepare("INSERT INTO activity_log (type, detail, created_at) VALUES (?, ?, ?)").run(type, JSON.stringify(detail), now());
}

export function listActivity(limit = 200): ActivityEvent[] {
  const rows = db()
    .prepare("SELECT id, type, detail, created_at FROM activity_log ORDER BY id DESC LIMIT ?")
    .all(limit) as { id: number; type: string; detail: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, type: r.type, detail: JSON.parse(r.detail), createdAt: r.created_at }));
}

export function clearActivity(): number {
  return Number(db().prepare("DELETE FROM activity_log").run().changes);
}
