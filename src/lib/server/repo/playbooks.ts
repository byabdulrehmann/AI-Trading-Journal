import "server-only";
import { db, now, transaction } from "../db";
import { audit } from "./audit";
import { missedR, type MissedInput, type MissedTrade, type PlaybookInput, type PlaybookRule, type RuleGroup } from "@/lib/domain/playbooks";

export interface StoredPlaybook {
  id: number;
  name: string;
  description: string;
  isSample: boolean;
  rules: PlaybookRule[];
}

type Row = { id: number; name: string; description: string; is_sample: number };

function rulesOf(strategyId: number): PlaybookRule[] {
  const rows = db().prepare("SELECT id, group_name, text FROM strategy_rules WHERE strategy_id = ? ORDER BY position, id").all(strategyId) as { id: number; group_name: string; text: string }[];
  return rows.map((r) => ({ id: r.id, group: r.group_name as RuleGroup, text: r.text }));
}

const toPlaybook = (r: Row): StoredPlaybook => ({ id: r.id, name: r.name, description: r.description, isSample: r.is_sample === 1, rules: rulesOf(r.id) });

/** A sample playbook stays out unless asked for, except once the user's own trades use it. */
export function listPlaybooks(userId: number, includeSample: boolean): StoredPlaybook[] {
  const rows = db()
    .prepare(`SELECT s.id, s.name, s.description, s.is_sample FROM strategies s WHERE s.user_id = ?
      ${includeSample ? "" : "AND (s.is_sample = 0 OR EXISTS (SELECT 1 FROM trades t WHERE t.strategy_id = s.id AND t.source != 'sample' AND t.deleted_at IS NULL))"}
      ORDER BY s.name`)
    .all(userId) as Row[];
  return rows.map(toPlaybook);
}

export function getPlaybook(userId: number, id: number): StoredPlaybook | null {
  const r = db().prepare("SELECT id, name, description, is_sample FROM strategies WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return r ? toPlaybook(r) : null;
}

export const playbookNameTaken = (userId: number, name: string, exceptId?: number) =>
  Boolean(db().prepare("SELECT 1 FROM strategies WHERE user_id = ? AND name = ? AND id != ?").get(userId, name, exceptId ?? 0));

/** Rules that keep their id keep their history. Rules left out go, and their answers with them. */
function saveRules(strategyId: number, rules: PlaybookInput["rules"]) {
  const conn = db();
  const existing = new Set((conn.prepare("SELECT id FROM strategy_rules WHERE strategy_id = ?").all(strategyId) as { id: number }[]).map((r) => r.id));
  const kept = new Set(rules.flatMap((r) => (r.id && existing.has(r.id) ? [r.id] : [])));
  for (const id of existing) if (!kept.has(id)) conn.prepare("DELETE FROM strategy_rules WHERE id = ?").run(id);
  rules.forEach((r, position) => {
    if (r.id && kept.has(r.id)) conn.prepare("UPDATE strategy_rules SET group_name = ?, text = ?, position = ? WHERE id = ?").run(r.group, r.text, position, r.id);
    else conn.prepare("INSERT INTO strategy_rules (strategy_id, group_name, text, position) VALUES (?, ?, ?, ?)").run(strategyId, r.group, r.text, position);
  });
}

export function createPlaybook(userId: number, p: PlaybookInput): StoredPlaybook {
  const id = transaction(db(), () => {
    const created = Number(db().prepare("INSERT INTO strategies (user_id, name, description, created_at) VALUES (?, ?, ?, ?)").run(userId, p.name, p.description, now()).lastInsertRowid);
    saveRules(created, p.rules);
    audit(userId, "playbook.created", "strategy", created);
    return created;
  });
  return getPlaybook(userId, id) as StoredPlaybook;
}

export function updatePlaybook(userId: number, id: number, p: Partial<PlaybookInput>): StoredPlaybook | null {
  const cur = getPlaybook(userId, id);
  if (!cur) return null;
  transaction(db(), () => {
    db().prepare("UPDATE strategies SET name = ?, description = ? WHERE id = ?").run(p.name ?? cur.name, p.description ?? cur.description, id);
    if (p.rules) saveRules(id, p.rules);
  });
  return getPlaybook(userId, id);
}

/** The trades stay, with no playbook. */
export function deletePlaybook(userId: number, id: number): boolean {
  const changes = Number(db().prepare("DELETE FROM strategies WHERE id = ? AND user_id = ?").run(id, userId).changes);
  if (changes) audit(userId, "playbook.deleted", "strategy", id);
  return changes > 0;
}

// ---------- a trade's checklist ----------

export interface TradeChecklist {
  strategyId: number | null;
  strategy: string | null;
  reviewed: boolean;
  rules: (PlaybookRule & { checked: boolean })[];
}

export function tradeChecklist(userId: number, tradeId: number): TradeChecklist | null {
  const t = db().prepare("SELECT t.strategy_id, s.name FROM trades t LEFT JOIN strategies s ON s.id = t.strategy_id WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL").get(tradeId, userId) as { strategy_id: number | null; name: string | null } | undefined;
  if (!t) return null;
  if (t.strategy_id === null) return { strategyId: null, strategy: null, reviewed: false, rules: [] };
  const answers = new Map((db().prepare("SELECT rule_id, checked FROM trade_rule_checks WHERE trade_id = ?").all(tradeId) as { rule_id: number; checked: number }[]).map((c) => [c.rule_id, c.checked === 1]));
  const rules = rulesOf(t.strategy_id);
  return { strategyId: t.strategy_id, strategy: t.name, reviewed: rules.some((r) => answers.has(r.id)), rules: rules.map((r) => ({ ...r, checked: answers.get(r.id) ?? false })) };
}

/**
 * Stores an answer for every current rule, so a rule added later doesn't lower the score of a trade reviewed before
 * it existed. Null clears the answers. Ids that aren't this trade's rules are ignored.
 */
export function saveChecklist(userId: number, tradeId: number, checked: number[] | null): TradeChecklist | null {
  const list = tradeChecklist(userId, tradeId);
  if (!list) return null;
  const conn = db();
  transaction(conn, () => {
    conn.prepare("DELETE FROM trade_rule_checks WHERE trade_id = ?").run(tradeId);
    if (checked) {
      const on = new Set(checked);
      const insert = conn.prepare("INSERT INTO trade_rule_checks (trade_id, rule_id, checked) VALUES (?, ?, ?)");
      for (const r of list.rules) insert.run(tradeId, r.id, on.has(r.id) ? 1 : 0);
    }
  });
  return tradeChecklist(userId, tradeId);
}

/** Answers on rules of each trade's current playbook. Changing a trade's playbook leaves old answers out of it. */
export function checklistTotals(userId: number): Map<number, { done: number; total: number }> {
  const rows = db()
    .prepare(`SELECT t.id AS trade_id, COUNT(*) AS total, SUM(c.checked) AS done FROM trades t
      JOIN trade_rule_checks c ON c.trade_id = t.id
      JOIN strategy_rules r ON r.id = c.rule_id AND r.strategy_id = t.strategy_id
      WHERE t.user_id = ? GROUP BY t.id`)
    .all(userId) as { trade_id: number; total: number; done: number }[];
  return new Map(rows.map((r) => [r.trade_id, { done: r.done, total: r.total }]));
}

// ---------- missed trades ----------

type MissedRow = { id: number; strategy_id: number | null; symbol: string; side: "long" | "short"; at: string; entry_price: number; stop_price: number | null; exit_price: number | null; reason: string; is_sample: number; created_at: string };

function toMissed(r: MissedRow): MissedTrade {
  const m = { strategyId: r.strategy_id, symbol: r.symbol, side: r.side, at: r.at, entryPrice: r.entry_price, stopPrice: r.stop_price, exitPrice: r.exit_price, reason: r.reason };
  return { ...m, id: r.id, isSample: r.is_sample === 1, r: missedR(m), createdAt: r.created_at };
}

export function listMissed(userId: number, includeSample: boolean): MissedTrade[] {
  const rows = db().prepare(`SELECT * FROM missed_trades WHERE user_id = ?${includeSample ? "" : " AND is_sample = 0"} ORDER BY at DESC, id DESC`).all(userId) as MissedRow[];
  return rows.map(toMissed);
}

export function createMissed(userId: number, m: MissedInput, isSample = false): MissedTrade {
  const res = db()
    .prepare("INSERT INTO missed_trades (user_id, strategy_id, symbol, side, at, entry_price, stop_price, exit_price, reason, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(userId, m.strategyId, m.symbol, m.side, new Date(m.at).toISOString(), m.entryPrice, m.stopPrice, m.exitPrice, m.reason, isSample ? 1 : 0, now());
  return toMissed(db().prepare("SELECT * FROM missed_trades WHERE id = ?").get(res.lastInsertRowid) as MissedRow);
}

export const deleteMissed = (userId: number, id: number) => Number(db().prepare("DELETE FROM missed_trades WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
