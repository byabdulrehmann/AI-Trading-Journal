import "server-only";
import { ruleMatches, type RuleCondition, type TagRuleInput } from "@/lib/domain/autotag";
import { minutesToNews } from "@/lib/domain/econ";
import { zoneParts } from "@/lib/domain/zone";
import { db, now, transaction } from "./db";
import { audit } from "./repo/audit";
import { getSettings } from "./repo/settings";

export interface TagRule {
  id: number;
  tag: string;
  conditions: RuleCondition[];
  createdAt: string;
  /** Trades this rule has tagged. */
  tagged: number;
}

type Row = Record<string, unknown>;
const MAX_TAGS = 12;
const NEWS_WINDOW_MS = 24 * 3600_000;

export function listRules(userId: number): TagRule[] {
  return (db().prepare("SELECT r.*, (SELECT COUNT(*) FROM tag_rule_hits h WHERE h.rule_id = r.id) AS tagged FROM tag_rules r WHERE r.user_id = ? ORDER BY r.id").all(userId) as Row[]).map((r) => ({
    id: r.id as number,
    tag: r.tag as string,
    conditions: JSON.parse(r.conditions as string),
    createdAt: r.created_at as string,
    tagged: r.tagged as number,
  }));
}

/**
 * Adds each matching rule's tag to the trade, once per rule. Only adds: a tag the trader removed
 * stays removed, and nothing else on the trade changes. Runs inside the caller's transaction.
 */
export function applyRules(tradeId: number, rules?: TagRule[]): number {
  const conn = db();
  const t = conn.prepare("SELECT * FROM trades WHERE id = ? AND deleted_at IS NULL").get(tradeId) as Row | undefined;
  if (!t) return 0;
  const userId = t.user_id as number;
  rules ??= listRules(userId);
  const done = new Set((conn.prepare("SELECT rule_id FROM tag_rule_hits WHERE trade_id = ?").all(tradeId) as { rule_id: number }[]).map((r) => r.rule_id));
  const pending = rules.filter((r) => !done.has(r.id));
  if (!pending.length) return 0;

  const openedMs = Date.parse(t.opened_at as string);
  const p = zoneParts(openedMs, getSettings(userId).timeZone || undefined);
  const news = pending.some((r) => r.conditions.some((c) => c.field === "news"))
    ? (conn.prepare("SELECT at, all_day, impact, currency FROM economic_events WHERE user_id = ? AND impact = 'high' AND at BETWEEN ? AND ?")
        .all(userId, new Date(openedMs - NEWS_WINDOW_MS).toISOString(), new Date(openedMs + NEWS_WINDOW_MS).toISOString()) as Row[])
        .map((e) => ({ at: e.at as string, allDay: e.all_day === 1, impact: e.impact as string, currency: e.currency as string }))
    : [];
  const closed = t.status === "closed" && t.pnl_status === "ok";
  const facts = {
    symbol: t.symbol as string,
    side: t.side as string,
    session: t.session as string | null,
    weekday: p.weekday,
    hour: p.hour,
    closed,
    holdMinutes: closed ? (t.holding_minutes as number | null) : null,
    r: closed ? (t.r_multiple as number | null) : null,
    pnl: closed ? (t.net_pnl as number | null) : null,
    newsMinutes: minutesToNews(t.symbol as string, openedMs, news),
  };

  let added = 0;
  for (const rule of pending) {
    if (ruleMatches(rule.conditions, facts) !== true) continue;
    const tags = (conn.prepare("SELECT g.name FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.trade_id = ? AND g.kind = 'custom'").all(tradeId) as { name: string }[]).map((r) => r.name);
    // A full trade can't take one more: the trade form would refuse to save it. Tried again on the next change.
    if (!tags.includes(rule.tag) && tags.length >= MAX_TAGS) continue;
    conn.prepare("INSERT OR IGNORE INTO tags (user_id, name, kind) VALUES (?, ?, 'custom')").run(userId, rule.tag);
    const tag = conn.prepare("SELECT id FROM tags WHERE user_id = ? AND name = ? AND kind = 'custom'").get(userId, rule.tag) as { id: number };
    conn.prepare("INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)").run(tradeId, tag.id);
    conn.prepare("INSERT INTO tag_rule_hits (rule_id, trade_id) VALUES (?, ?)").run(rule.id, tradeId);
    added++;
  }
  return added;
}

/** Runs the rules over every trade, for a new rule or new calendar events. Returns how many tags were added. */
export function applyRulesToAll(userId: number): number {
  const rules = listRules(userId);
  if (!rules.length) return 0;
  const ids = db().prepare("SELECT id FROM trades WHERE user_id = ? AND deleted_at IS NULL").all(userId) as { id: number }[];
  return transaction(db(), () => ids.reduce((n, { id }) => n + applyRules(id, rules), 0));
}

export function createRule(userId: number, input: TagRuleInput): { rule: TagRule; tagged: number } {
  const id = Number(db().prepare("INSERT INTO tag_rules (user_id, tag, conditions, created_at) VALUES (?, ?, ?, ?)").run(userId, input.tag, JSON.stringify(input.conditions), now()).lastInsertRowid);
  audit(userId, "tag_rule.created", "tag_rule", id);
  const tagged = applyRulesToAll(userId);
  return { rule: listRules(userId).find((r) => r.id === id)!, tagged };
}

/** The tags it added stay on their trades. */
export function deleteRule(userId: number, id: number): boolean {
  const ok = db().prepare("DELETE FROM tag_rules WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  if (ok) audit(userId, "tag_rule.deleted", "tag_rule", id);
  return ok;
}
