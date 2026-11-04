import "server-only";
import { db, now } from "../db";

/** Always on, unlike the opt-in activity log. Detail must never hold secrets or trade notes. */
export function audit(userId: number | null, type: string, entity?: string, entityId?: string | number, detail: Record<string, unknown> = {}) {
  db()
    .prepare("INSERT INTO audit_events (user_id, type, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, type, entity ?? null, entityId === undefined ? null : String(entityId), JSON.stringify(detail), now());
}
