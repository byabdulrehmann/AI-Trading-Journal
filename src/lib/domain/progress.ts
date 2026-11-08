import { addMoney } from "./engine/position";
import { zoneParts } from "./zone";

/** Day keys are YYYY-MM-DD. Day arithmetic runs on UTC midnights, so no clock change can skip or repeat a day. */
const dayMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => keyOf(dayMs(key) + n * 86400000);
const weekday = (key: string) => new Date(dayMs(key)).getUTCDay();
const isWeekend = (key: string) => weekday(key) === 0 || weekday(key) === 6;

/**
 * The trading day an instant belongs to, for a firm that starts its day at `resetHour` in `zone`.
 * With a 17:00 reset, 18:00 on Monday already counts as Tuesday.
 */
export function tradingDay(ms: number, zone?: string, resetHour = 0): string {
  const p = zoneParts(ms, zone);
  const key = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return resetHour > 0 && p.hour >= resetHour ? addDays(key, 1) : key;
}

// ---------- Prop challenges ----------

export interface ChallengeRules {
  accountSize: number;
  /** Null: no target, as on a funded account. */
  profitTarget: number | null;
  dailyLoss: number | null;
  maxLoss: number | null;
  /** Static: the floor stays at size minus max loss. Trailing: it follows the highest balance up, and stops at the starting size. */
  maxLossType: "static" | "trailing";
  minDays: number;
  /** The best day may make at most this share of the total profit, in percent. */
  consistencyPct: number | null;
  startDate: string;
  endDate: string | null;
}

export interface ChallengeTrade {
  id: number;
  pnl: number;
  /** Already turned into the firm's trading day. */
  day: string;
  closedAt: string;
}

export type RuleState = "ok" | "warn" | "breached" | "met" | "pending";

export interface RuleCheck {
  key: "target" | "daily" | "max" | "days" | "consistency" | "time";
  label: string;
  state: RuleState;
  /** What is used or reached so far, in money, days or percent. */
  value: number;
  limit: number;
  /** Share of a limit used, or of a target reached, 0 to 1 and over. */
  progress: number;
  detail: string;
}

export interface ChallengeResult {
  status: "active" | "passed" | "failed" | "expired";
  balance: number;
  equity: number;
  profit: number;
  tradingDays: number;
  floor: number | null;
  breach: { day: string; rule: "daily" | "max"; detail: string } | null;
  today: { day: string; closed: number; floating: number | null; startBalance: number; loss: number; left: number | null };
  rules: RuleCheck[];
  /** Days and amounts, for the chart. */
  days: { day: string; pnl: number; balance: number; low: number }[];
}

/** Share of a limit at which a rule turns to a warning. */
export const WARN_AT = 0.8;

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a challenge stands, from its closed trades in order and, for today, the open positions' floating result.
 * Breach checks run on every closed trade, so a day that dipped past the limit and came back still counts as a breach.
 * A limit reached exactly counts as breached: the safe reading when a firm's wording is unclear.
 */
export function evaluateChallenge(rules: ChallengeRules, trades: ChallengeTrade[], today: string, floating: number | null): ChallengeResult {
  const S = rules.accountSize;
  const sorted = trades.filter((t) => t.day >= rules.startDate && (!rules.endDate || t.day <= rules.endDate)).sort((a, b) => a.closedAt.localeCompare(b.closedAt) || a.id - b.id);
  const floorAt = (peak: number) => (rules.maxLoss === null ? null : rules.maxLossType === "trailing" ? Math.min(round(peak - rules.maxLoss), S) : round(S - rules.maxLoss));

  let balance = S;
  let peak = S;
  let breach: ChallengeResult["breach"] = null;
  const days: ChallengeResult["days"] = [];
  const dayStart = new Map<string, number>();
  for (const t of sorted) {
    let d = days.at(-1);
    if (!d || d.day !== t.day) {
      dayStart.set(t.day, balance);
      d = { day: t.day, pnl: 0, balance, low: balance };
      days.push(d);
    }
    // The floor in force before this trade closed: a trailing floor moves after a new high, not with it.
    const floor = floorAt(peak);
    balance = addMoney([balance, t.pnl]);
    d.pnl = addMoney([d.pnl, t.pnl]);
    d.balance = balance;
    d.low = Math.min(d.low, balance);
    peak = Math.max(peak, balance);
    if (breach) continue;
    const start = dayStart.get(t.day)!;
    if (rules.dailyLoss !== null && round(start - balance) >= rules.dailyLoss)
      breach = { day: t.day, rule: "daily", detail: `Lost ${round(start - balance)} on ${t.day}, against a daily limit of ${rules.dailyLoss}.` };
    else if (floor !== null && balance <= floor) breach = { day: t.day, rule: "max", detail: `Balance fell to ${balance}, at or below the floor of ${floor}.` };
  }

  const todayStart = dayStart.get(today) ?? balance;
  const closedToday = days.find((d) => d.day === today)?.pnl ?? 0;
  const equity = addMoney([balance, floating ?? 0]);
  const floor = floorAt(peak);
  const lowToday = Math.min(days.find((d) => d.day === today)?.low ?? todayStart, equity);
  const lossToday = Math.max(0, round(todayStart - lowToday));
  const nowLoss = Math.max(0, round(todayStart - equity));
  if (!breach && rules.dailyLoss !== null && nowLoss >= rules.dailyLoss) breach = { day: today, rule: "daily", detail: `Down ${nowLoss} today with open positions, against a daily limit of ${rules.dailyLoss}.` };
  if (!breach && floor !== null && floating !== null && equity <= floor) breach = { day: today, rule: "max", detail: `Equity is ${equity} with open positions, at or below the floor of ${floor}.` };

  const profit = round(balance - S);
  const tradingDays = days.length;
  const checks: RuleCheck[] = [];
  const limitState = (used: number, limit: number, breached: boolean): RuleState => (breached ? "breached" : used >= limit * WARN_AT ? "warn" : "ok");

  if (rules.profitTarget !== null) {
    const met = profit >= rules.profitTarget;
    checks.push({ key: "target", label: "Profit target", state: met ? "met" : "pending", value: profit, limit: rules.profitTarget, progress: Math.max(0, profit / rules.profitTarget), detail: met ? "Reached." : `${round(rules.profitTarget - profit)} to go.` });
  }
  if (rules.dailyLoss !== null) {
    const used = Math.max(lossToday, nowLoss);
    const hit = breach?.rule === "daily";
    checks.push({ key: "daily", label: "Daily loss", state: limitState(used, rules.dailyLoss, hit), value: used, limit: rules.dailyLoss, progress: used / rules.dailyLoss, detail: hit ? breach!.detail : `${round(Math.max(0, rules.dailyLoss - used))} left today.` });
  }
  if (rules.maxLoss !== null && floor !== null) {
    const used = Math.max(0, round(rules.maxLoss - (equity - floor)));
    const hit = breach?.rule === "max";
    checks.push({ key: "max", label: rules.maxLossType === "trailing" ? "Max loss (trailing)" : "Max loss", state: limitState(used, rules.maxLoss, hit), value: used, limit: rules.maxLoss, progress: used / rules.maxLoss, detail: hit ? breach!.detail : `Floor at ${floor}. ${round(Math.max(0, equity - floor))} above it.` });
  }
  if (rules.minDays > 0) {
    const met = tradingDays >= rules.minDays;
    checks.push({ key: "days", label: "Trading days", state: met ? "met" : "pending", value: tradingDays, limit: rules.minDays, progress: tradingDays / rules.minDays, detail: met ? "Enough days." : `${rules.minDays - tradingDays} more ${rules.minDays - tradingDays === 1 ? "day" : "days"} needed.` });
  }
  let consistent = true;
  if (rules.consistencyPct !== null) {
    const best = Math.max(0, ...days.map((d) => d.pnl));
    const share = profit > 0 ? (best / profit) * 100 : 0;
    consistent = profit > 0 && share <= rules.consistencyPct;
    checks.push({ key: "consistency", label: "Consistency", state: profit <= 0 ? "pending" : consistent ? "met" : "warn", value: round(share), limit: rules.consistencyPct, progress: share / rules.consistencyPct, detail: profit <= 0 ? "Counts once you're in profit." : `Best day is ${Math.round(share)}% of the profit${consistent ? "." : `, over ${rules.consistencyPct}%.`}` });
  }
  if (rules.endDate) {
    const span = Math.max(1, (dayMs(rules.endDate) - dayMs(rules.startDate)) / 86400000 + 1);
    const gone = Math.min(span, Math.max(0, (dayMs(today) - dayMs(rules.startDate)) / 86400000 + 1));
    const over = today > rules.endDate;
    checks.push({ key: "time", label: "Time", state: over ? "breached" : gone / span >= WARN_AT ? "warn" : "ok", value: gone, limit: span, progress: gone / span, detail: over ? `Ended on ${rules.endDate}.` : `${span - gone} ${span - gone === 1 ? "day" : "days"} left, to ${rules.endDate}.` });
  }

  const passed = !breach && rules.profitTarget !== null && profit >= rules.profitTarget && tradingDays >= rules.minDays && consistent;
  const status = breach ? "failed" : passed ? "passed" : rules.endDate && today > rules.endDate ? "expired" : "active";
  return {
    status,
    balance,
    equity,
    profit,
    tradingDays,
    floor,
    breach,
    today: { day: today, closed: closedToday, floating, startBalance: todayStart, loss: Math.max(lossToday, nowLoss), left: rules.dailyLoss === null ? null : round(Math.max(0, rules.dailyLoss - Math.max(lossToday, nowLoss))) },
    rules: checks,
    days,
  };
}

// ---------- Streaks ----------

export interface Streak {
  current: number;
  best: number;
}

/**
 * Days in a row, weekends skipped (they neither count nor break a run). Today still to come doesn't break the run:
 * with no entry yet today, the run ending on the last weekday stands.
 */
export function dayStreak(days: Iterable<string>, today: string): Streak {
  const set = new Set([...days].filter((d) => !isWeekend(d) && d <= today));
  const prevWeekday = (d: string) => {
    let p = addDays(d, -1);
    while (isWeekend(p)) p = addDays(p, -1);
    return p;
  };
  let cursor = today;
  while (isWeekend(cursor)) cursor = prevWeekday(cursor);
  if (!set.has(cursor)) cursor = prevWeekday(cursor);
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = prevWeekday(cursor);
  }
  const nextWeekday = (d: string) => addDays(d, weekday(d) === 5 ? 3 : 1);
  let best = 0;
  for (const d of set) {
    if (set.has(prevWeekday(d))) continue;
    let n = 0;
    for (let c = d; set.has(c); c = nextWeekday(c)) n++;
    best = Math.max(best, n);
  }
  return { current, best: Math.max(best, current) };
}

/** Runs of `true` in order; the current run is the one at the end. */
export function runStreak(flags: boolean[]): Streak {
  let run = 0;
  let best = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/** Days whose routine was complete: every item that existed that day was ticked. */
export function completeRoutineDays(items: { id: number; from: string; until: string | null }[], checks: Map<string, Set<number>>): Set<string> {
  const out = new Set<string>();
  for (const [day, ticked] of checks) {
    const due = items.filter((i) => i.from <= day && (i.until === null || i.until > day));
    if (due.length && due.every((i) => ticked.has(i.id))) out.add(day);
  }
  return out;
}

// ---------- Goals ----------

export const GOAL_KINDS = {
  net_pnl: { label: "Net P&L", unit: "money", direction: "at_least" },
  win_rate: { label: "Win rate", unit: "percent", direction: "at_least" },
  max_day_loss: { label: "Worst day no worse than", unit: "money", direction: "limit" },
  max_trades_day: { label: "Trades a day, at most", unit: "count", direction: "limit" },
  journal_days: { label: "Days journaled", unit: "count", direction: "at_least" },
  routine_days: { label: "Routine days completed", unit: "count", direction: "at_least" },
  rules_followed: { label: "Trades with every rule followed", unit: "percent", direction: "at_least" },
} as const;
export type GoalKind = keyof typeof GOAL_KINDS;

export function periodRange(period: "week" | "month", today: string): { from: string; to: string } {
  if (period === "week") {
    const from = addDays(today, -((weekday(today) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = `${today.slice(0, 7)}-01`;
  const next = new Date(dayMs(from));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(keyOf(next.getTime()), -1) };
}

export const previousPeriod = (period: "week" | "month", today: string) => periodRange(period, addDays(periodRange(period, today).from, -1));

export interface GoalInputs {
  /** Closed trades in the period with a known result, in the goal's currency for money goals. */
  trades: { pnl: number; day: string; rulesFollowed: boolean | null }[];
  journalDays: number;
  routineDays: number;
}

export interface GoalResult {
  value: number | null;
  state: "met" | "on_track" | "behind" | "missed" | "no_data";
  progress: number;
  detail: string;
}

/** A target is met once reached; a limit holds until broken. When the period is over, anything short is missed. */
export function evaluateGoal(kind: GoalKind, target: number, d: GoalInputs, periodOver: boolean): GoalResult {
  const def = GOAL_KINDS[kind];
  const byDay = new Map<string, { pnl: number; n: number }>();
  for (const t of d.trades) {
    const x = byDay.get(t.day) ?? { pnl: 0, n: 0 };
    x.pnl = addMoney([x.pnl, t.pnl]);
    x.n++;
    byDay.set(t.day, x);
  }
  let value: number | null;
  switch (kind) {
    case "net_pnl":
      value = addMoney(d.trades.map((t) => t.pnl));
      break;
    case "win_rate": {
      const decided = d.trades.filter((t) => t.pnl !== 0);
      value = decided.length ? round((decided.filter((t) => t.pnl > 0).length / decided.length) * 100) : null;
      break;
    }
    case "max_day_loss":
      value = byDay.size ? Math.max(0, ...[...byDay.values()].map((x) => -x.pnl)) : null;
      break;
    case "max_trades_day":
      value = byDay.size ? Math.max(...[...byDay.values()].map((x) => x.n)) : null;
      break;
    case "journal_days":
      value = d.journalDays;
      break;
    case "routine_days":
      value = d.routineDays;
      break;
    case "rules_followed": {
      const checked = d.trades.filter((t) => t.rulesFollowed !== null);
      value = checked.length ? round((checked.filter((t) => t.rulesFollowed).length / checked.length) * 100) : null;
      break;
    }
  }
  if (value === null) return { value, state: "no_data", progress: 0, detail: kind === "rules_followed" ? "No trades with a playbook checklist yet." : "No closed trades yet." };
  if (def.direction === "limit") {
    const ok = value <= target;
    return { value, state: ok ? (periodOver ? "met" : "on_track") : "missed", progress: target > 0 ? value / target : ok ? 0 : 1, detail: ok ? "Within the limit so far." : "Over the limit." };
  }
  const reached = value >= target;
  return { value, state: reached ? "met" : periodOver ? "missed" : "behind", progress: target > 0 ? Math.max(0, value / target) : reached ? 1 : 0, detail: reached ? "Reached." : periodOver ? "Not reached." : "Not reached yet." };
}
