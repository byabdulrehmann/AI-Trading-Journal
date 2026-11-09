import "server-only";
import { eventApplies, type EventData } from "@/lib/domain/econ";
import { applyRulesToAll } from "./autotag";
import { db, now, transaction } from "./db";
import { audit } from "./repo/audit";
import { getTrade } from "./repo/journal";

export interface EconomicEvent extends EventData {
  id: number;
  source: "manual" | "csv";
}

type Row = Record<string, unknown>;
const toEvent = (r: Row): EconomicEvent => ({
  id: r.id as number,
  at: r.at as string,
  allDay: r.all_day === 1,
  currency: r.currency as string,
  title: r.title as string,
  impact: r.impact as EventData["impact"],
  actual: r.actual as string,
  forecast: r.forecast as string,
  previous: r.previous as string,
  source: r.source as EconomicEvent["source"],
});

export function listEvents(userId: number, from?: string, to?: string): EconomicEvent[] {
  return (db().prepare("SELECT * FROM economic_events WHERE user_id = ? AND at >= ? AND at <= ? ORDER BY at, currency, title").all(userId, from ?? "0000", to ?? "9999") as Row[]).map(toEvent);
}

const insert = (userId: number, e: EventData, source: string) =>
  db().prepare(`INSERT INTO economic_events (user_id, at, all_day, currency, title, impact, actual, forecast, previous, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, at, currency, title) DO NOTHING`)
    .run(userId, e.at, e.allDay ? 1 : 0, e.currency, e.title, e.impact, e.actual, e.forecast, e.previous, source, now()).changes > 0;

export function createEvent(userId: number, e: EventData): { ok: true; tagged: number } | { ok: false; reason: string } {
  if (!insert(userId, e, "manual")) return { ok: false, reason: "That event is already in your calendar at that time." };
  return { ok: true, tagged: applyRulesToAll(userId) };
}

/** Adds the events not already there; the same event at the same time is skipped, so a file can be imported twice. */
export function importEvents(userId: number, events: EventData[]): { added: number; skipped: number; tagged: number } {
  const added = transaction(db(), () => events.reduce((n, e) => n + (insert(userId, e, "csv") ? 1 : 0), 0));
  audit(userId, "events.imported", undefined, undefined, { added });
  return { added, skipped: events.length - added, tagged: added ? applyRulesToAll(userId) : 0 };
}

export function deleteEvent(userId: number, id: number): boolean {
  return db().prepare("DELETE FROM economic_events WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function deleteAllEvents(userId: number): number {
  return Number(db().prepare("DELETE FROM economic_events WHERE user_id = ?").run(userId).changes);
}

const HOUR = 3600_000;

/** Events for the trade's symbol from an hour before it opened to an hour after it closed. */
export function eventsNearTrade(userId: number, tradeId: number): EconomicEvent[] | null {
  const t = getTrade(userId, tradeId);
  if (!t) return null;
  const from = new Date(Date.parse(t.openedAt) - HOUR).toISOString();
  const to = new Date(Date.parse(t.closedAt ?? t.openedAt) + HOUR).toISOString();
  return listEvents(userId, from, to).filter((e) => !e.allDay && eventApplies(t.symbol, e.currency));
}
