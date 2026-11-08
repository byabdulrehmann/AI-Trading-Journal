import "server-only";
import { z } from "zod";
import { isValidZone, zoneDateKey } from "@/lib/domain/zone";
import { GOAL_KINDS, completeRoutineDays, dayStreak, evaluateChallenge, evaluateGoal, periodRange, previousPeriod, runStreak, tradingDay, type ChallengeResult, type GoalKind, type GoalResult, type Streak } from "@/lib/domain/progress";
import { addMoney } from "@/lib/domain/engine/position";
import { db, now } from "./db";
import { audit } from "./repo/audit";
import { listDays } from "./repo/daily";
import { getAccount, listAccounts, listTrades } from "./repo/journal";
import { checklistTotals } from "./repo/playbooks";
import { getSettings } from "./repo/settings";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-02");
const amount = z.number().positive("Must be more than zero").max(1e9);
const optionalAmount = amount.nullable().default(null);

// ---------- challenges ----------

export const ChallengeInput = z
  .object({
    accountId: z.number().int().positive(),
    name: z.string().trim().min(1, "Name is required").max(60),
    firm: z.string().trim().max(60).default(""),
    startDate: day,
    endDate: day.nullable().default(null),
    accountSize: amount,
    profitTarget: optionalAmount,
    dailyLoss: optionalAmount,
    maxLoss: optionalAmount,
    maxLossType: z.enum(["static", "trailing"]).default("static"),
    minDays: z.number().int().min(0).max(365).default(0),
    consistencyPct: z.number().gt(0).max(100).nullable().default(null),
    resetZone: z.string().max(64).refine((v) => v === "" || isValidZone(v), "Unknown time zone").default(""),
    resetHour: z.number().int().min(0).max(23).default(0),
  })
  .refine((c) => !c.endDate || c.endDate >= c.startDate, { path: ["endDate"], message: "Must be on or after the start" })
  .refine((c) => c.maxLoss === null || c.maxLoss < c.accountSize, { path: ["maxLoss"], message: "Must be less than the account size" });
export type ChallengeInput = z.output<typeof ChallengeInput>;

type ChallengeRow = {
  id: number; account_id: number; name: string; firm: string; start_date: string; end_date: string | null; account_size: number; profit_target: number | null; daily_loss: number | null;
  max_loss: number | null; max_loss_type: "static" | "trailing"; min_days: number; consistency_pct: number | null; reset_zone: string; reset_hour: number; archived: number; created_at: string; updated_at: string;
};

export interface Challenge extends ChallengeInput {
  id: number;
  accountName: string;
  currency: string;
  isSample: boolean;
  archived: boolean;
  createdAt: string;
  result: ChallengeResult;
  /** When the open positions' result was read from MT5. Null: none counted. */
  floatingAt: string | null;
  /** Closed in the window but left out: missing a conversion rate or with bad fills. */
  excluded: number;
}

const toInput = (r: ChallengeRow): ChallengeInput => ({
  accountId: r.account_id, name: r.name, firm: r.firm, startDate: r.start_date, endDate: r.end_date, accountSize: r.account_size, profitTarget: r.profit_target, dailyLoss: r.daily_loss,
  maxLoss: r.max_loss, maxLossType: r.max_loss_type, minDays: r.min_days, consistencyPct: r.consistency_pct, resetZone: r.reset_zone, resetHour: r.reset_hour,
});

/** The open positions' result from the last MT5 sync, when it was taken on the firm's current trading day. */
function floatingFor(accountId: number, zone: string | undefined, resetHour: number, today: string): { value: number; at: string } | null {
  const r = db().prepare("SELECT floating_pnl, snapshot_at FROM mt5_connections WHERE account_id = ? AND password_cipher IS NOT NULL").get(accountId) as { floating_pnl: number | null; snapshot_at: string | null } | undefined;
  if (!r || r.floating_pnl === null || !r.snapshot_at) return null;
  return tradingDay(Date.parse(r.snapshot_at), zone, resetHour) === today ? { value: r.floating_pnl, at: r.snapshot_at } : null;
}

function buildChallenge(userId: number, r: ChallengeRow, nowMs: number): Challenge | null {
  const account = getAccount(userId, r.account_id);
  if (!account) return null;
  const input = toInput(r);
  const zone = input.resetZone || getSettings(userId).timeZone || undefined;
  const today = tradingDay(nowMs, zone, input.resetHour);
  const all = listTrades(userId, { accountId: r.account_id }).filter((t) => t.status === "closed" && t.closedAt);
  const inWindow = (t: (typeof all)[number]) => {
    const d = tradingDay(Date.parse(t.closedAt!), zone, input.resetHour);
    return d >= input.startDate && (!input.endDate || d <= input.endDate);
  };
  const trades = all.filter((t) => t.pnlStatus === "ok" && t.pnl !== null).map((t) => ({ id: t.id, pnl: t.pnl!, closedAt: t.closedAt!, day: tradingDay(Date.parse(t.closedAt!), zone, input.resetHour) }));
  const floating = floatingFor(r.account_id, zone, input.resetHour, today);
  return {
    ...input,
    id: r.id,
    accountName: account.name,
    currency: account.currency,
    isSample: account.isSample,
    archived: r.archived === 1,
    createdAt: r.created_at,
    result: evaluateChallenge(input, trades, today, floating?.value ?? null),
    floatingAt: floating?.at ?? null,
    excluded: all.filter((t) => inWindow(t) && (t.pnlStatus !== "ok" || t.pnl === null)).length,
  };
}

export function listChallenges(userId: number, includeSample: boolean, nowMs = Date.now()): Challenge[] {
  const rows = db().prepare("SELECT * FROM challenges WHERE user_id = ? ORDER BY archived, start_date DESC, id DESC").all(userId) as ChallengeRow[];
  return rows.map((r) => buildChallenge(userId, r, nowMs)).filter((c): c is Challenge => c !== null && (includeSample || !c.isSample));
}

export function getChallenge(userId: number, id: number, nowMs = Date.now()): Challenge | null {
  const r = db().prepare("SELECT * FROM challenges WHERE id = ? AND user_id = ?").get(id, userId) as ChallengeRow | undefined;
  return r ? buildChallenge(userId, r, nowMs) : null;
}

/** A challenge runs on a real or sample account of the user's, never a backtest. */
function accountProblem(userId: number, accountId: number): string | null {
  const a = getAccount(userId, accountId);
  if (!a) return "Account not found";
  if (a.source === "backtest") return "A challenge can't run on a backtest account";
  return null;
}

export function createChallenge(userId: number, c: ChallengeInput): { ok: true; challenge: Challenge } | { ok: false; reason: string } {
  const problem = accountProblem(userId, c.accountId);
  if (problem) return { ok: false, reason: problem };
  const at = now();
  const id = Number(
    db()
      .prepare(`INSERT INTO challenges (user_id, account_id, name, firm, start_date, end_date, account_size, profit_target, daily_loss, max_loss, max_loss_type, min_days, consistency_pct, reset_zone, reset_hour, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, c.accountId, c.name, c.firm, c.startDate, c.endDate, c.accountSize, c.profitTarget, c.dailyLoss, c.maxLoss, c.maxLossType, c.minDays, c.consistencyPct, c.resetZone, c.resetHour, at, at).lastInsertRowid,
  );
  audit(userId, "challenge.created", "challenge", id);
  return { ok: true, challenge: getChallenge(userId, id)! };
}

export function updateChallenge(userId: number, id: number, c: ChallengeInput & { archived?: boolean }): { ok: true; challenge: Challenge } | { ok: false; reason: string; status: number } {
  if (!db().prepare("SELECT 1 FROM challenges WHERE id = ? AND user_id = ?").get(id, userId)) return { ok: false, reason: "Challenge not found", status: 404 };
  const problem = accountProblem(userId, c.accountId);
  if (problem) return { ok: false, reason: problem, status: 422 };
  db()
    .prepare(`UPDATE challenges SET account_id = ?, name = ?, firm = ?, start_date = ?, end_date = ?, account_size = ?, profit_target = ?, daily_loss = ?, max_loss = ?, max_loss_type = ?, min_days = ?,
      consistency_pct = ?, reset_zone = ?, reset_hour = ?, archived = COALESCE(?, archived), updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(c.accountId, c.name, c.firm, c.startDate, c.endDate, c.accountSize, c.profitTarget, c.dailyLoss, c.maxLoss, c.maxLossType, c.minDays, c.consistencyPct, c.resetZone, c.resetHour, c.archived === undefined ? null : Number(c.archived), now(), id, userId);
  return { ok: true, challenge: getChallenge(userId, id)! };
}

/** Its spending stays, unlinked: money spent is still spent. */
export function deleteChallenge(userId: number, id: number): boolean {
  const gone = Number(db().prepare("DELETE FROM challenges WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
  if (gone) audit(userId, "challenge.deleted", "challenge", id);
  return gone;
}

/** Active challenges with a rule at its warning level or past it, for the banner. */
export function challengeAlerts(userId: number, includeSample: boolean) {
  return listChallenges(userId, includeSample)
    .filter((c) => !c.archived && (c.result.status === "active" || c.result.breach?.day === c.result.today.day))
    .flatMap((c) => c.result.rules.filter((r) => (r.state === "warn" || r.state === "breached") && r.key !== "consistency").map((r) => ({ challengeId: c.id, name: c.name, currency: c.currency, rule: r })));
}

// ---------- spending ----------

export const EXPENSE_KINDS = { fee: "Challenge fee", reset: "Reset", subscription: "Subscription", other: "Other cost", payout: "Payout", refund: "Fee refund" } as const;
const INCOME: (keyof typeof EXPENSE_KINDS)[] = ["payout", "refund"];

export const ExpenseInput = z.object({
  date: day,
  kind: z.enum(Object.keys(EXPENSE_KINDS) as [keyof typeof EXPENSE_KINDS, ...(keyof typeof EXPENSE_KINDS)[]]),
  amount,
  currency: z.string().trim().length(3, "Three letters, like USD").toUpperCase(),
  firm: z.string().trim().max(60).default(""),
  challengeId: z.number().int().positive().nullable().default(null),
  note: z.string().trim().max(200).default(""),
});
export type ExpenseInput = z.output<typeof ExpenseInput>;

export interface Expense extends ExpenseInput {
  id: number;
  income: boolean;
}

export function listExpenses(userId: number): Expense[] {
  const rows = db().prepare("SELECT * FROM prop_expenses WHERE user_id = ? ORDER BY date DESC, id DESC").all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as number, date: r.date as string, kind: r.kind as Expense["kind"], amount: r.amount as number, currency: r.currency as string, firm: r.firm as string, challengeId: r.challenge_id as number | null, note: r.note as string, income: INCOME.includes(r.kind as Expense["kind"]) }));
}

/** Per currency: never added across currencies, since there's no rate to do it with. */
export function spendingSummary(expenses: Expense[]) {
  const by = new Map<string, { currency: string; spent: number; received: number; net: number; firms: Map<string, { spent: number; received: number }> }>();
  for (const e of expenses) {
    const s = by.get(e.currency) ?? { currency: e.currency, spent: 0, received: 0, net: 0, firms: new Map() };
    const f = s.firms.get(e.firm || "No firm") ?? { spent: 0, received: 0 };
    if (e.income) [s.received, f.received] = [addMoney([s.received, e.amount]), addMoney([f.received, e.amount])];
    else [s.spent, f.spent] = [addMoney([s.spent, e.amount]), addMoney([f.spent, e.amount])];
    s.net = addMoney([s.received, -s.spent]);
    s.firms.set(e.firm || "No firm", f);
    by.set(e.currency, s);
  }
  return [...by.values()].map((s) => ({ ...s, firms: [...s.firms].map(([firm, f]) => ({ firm, ...f, net: addMoney([f.received, -f.spent]) })).sort((a, b) => b.spent - a.spent) }));
}

export function createExpense(userId: number, e: ExpenseInput): { ok: true; expense: Expense } | { ok: false; reason: string } {
  if (e.challengeId !== null && !db().prepare("SELECT 1 FROM challenges WHERE id = ? AND user_id = ?").get(e.challengeId, userId)) return { ok: false, reason: "Challenge not found" };
  const id = Number(
    db()
      .prepare("INSERT INTO prop_expenses (user_id, challenge_id, firm, date, kind, amount, currency, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(userId, e.challengeId, e.firm, e.date, e.kind, e.amount, e.currency, e.note, now()).lastInsertRowid,
  );
  return { ok: true, expense: listExpenses(userId).find((x) => x.id === id)! };
}

export const deleteExpense = (userId: number, id: number) => Number(db().prepare("DELETE FROM prop_expenses WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;

// ---------- routine ----------

export const todayFor = (userId: number, nowMs = Date.now()) => zoneDateKey(nowMs, getSettings(userId).timeZone || undefined);

type ItemRow = { id: number; label: string; position: number; from_date: string; archived_date: string | null };
export interface RoutineItem {
  id: number;
  label: string;
  from: string;
  until: string | null;
}

export function routineItems(userId: number): RoutineItem[] {
  return (db().prepare("SELECT id, label, position, from_date, archived_date FROM routine_items WHERE user_id = ? ORDER BY position, id").all(userId) as ItemRow[]).map((r) => ({ id: r.id, label: r.label, from: r.from_date, until: r.archived_date }));
}

function routineChecks(userId: number): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const r of db().prepare("SELECT date, item_id FROM routine_checks WHERE user_id = ?").all(userId) as { date: string; item_id: number }[]) {
    out.set(r.date, (out.get(r.date) ?? new Set()).add(r.item_id));
  }
  return out;
}

export const RoutineItemInput = z.object({ label: z.string().trim().min(1, "Write the step").max(120) });

export function addRoutineItem(userId: number, label: string): RoutineItem {
  const position = (db().prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM routine_items WHERE user_id = ?").get(userId) as { p: number }).p;
  const id = Number(db().prepare("INSERT INTO routine_items (user_id, label, position, from_date, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, label, position, todayFor(userId), now()).lastInsertRowid);
  return routineItems(userId).find((i) => i.id === id)!;
}

export const RoutineItemPatch = z.object({ label: z.string().trim().min(1, "Write the step").max(120).optional(), archived: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional() });

/** Retiring a step keeps its past ticks, so days it was done stay complete. It drops off from today. */
export function updateRoutineItem(userId: number, id: number, p: z.output<typeof RoutineItemPatch>): RoutineItem | null {
  const item = routineItems(userId).find((i) => i.id === id);
  if (!item) return null;
  const until = p.archived === undefined ? item.until : p.archived ? (item.until ?? todayFor(userId)) : null;
  db().prepare("UPDATE routine_items SET label = ?, archived_date = ?, position = COALESCE(?, position) WHERE id = ? AND user_id = ?").run(p.label ?? item.label, until, p.position ?? null, id, userId);
  return routineItems(userId).find((i) => i.id === id)!;
}

export const RoutineCheck = z.object({ date: day, itemId: z.number().int().positive(), checked: z.boolean() });

export function setRoutineCheck(userId: number, c: z.output<typeof RoutineCheck>): { ok: true } | { ok: false; reason: string; status: number } {
  if (c.date > todayFor(userId)) return { ok: false, reason: "A day that hasn't come yet can't be ticked", status: 422 };
  if (!routineItems(userId).some((i) => i.id === c.itemId)) return { ok: false, reason: "Step not found", status: 404 };
  if (c.checked) db().prepare("INSERT OR IGNORE INTO routine_checks (user_id, date, item_id, checked_at) VALUES (?, ?, ?, ?)").run(userId, c.date, c.itemId, now());
  else db().prepare("DELETE FROM routine_checks WHERE user_id = ? AND date = ? AND item_id = ?").run(userId, c.date, c.itemId);
  return { ok: true };
}

export function routineDay(userId: number, date: string) {
  const ticked = routineChecks(userId).get(date) ?? new Set<number>();
  const due = routineItems(userId).filter((i) => i.until === null || i.until > date);
  return { date, items: due.map((i) => ({ ...i, checked: ticked.has(i.id) })) };
}

// ---------- goals ----------

export const GoalInput = z
  .object({
    kind: z.enum(Object.keys(GOAL_KINDS) as [GoalKind, ...GoalKind[]]),
    period: z.enum(["week", "month"]),
    target: z.number().min(0).max(1e9),
    accountId: z.number().int().positive().nullable().default(null),
    currency: z.string().trim().length(3).toUpperCase().nullable().default(null),
  })
  .refine((g) => GOAL_KINDS[g.kind].unit !== "percent" || g.target <= 100, { path: ["target"], message: "At most 100%" });
export type GoalInput = z.output<typeof GoalInput>;

export interface Goal extends GoalInput {
  id: number;
  label: string;
  unit: (typeof GOAL_KINDS)[GoalKind]["unit"];
  current: GoalResult & { from: string; to: string };
  previous: GoalResult & { from: string; to: string };
}

export function createGoal(userId: number, g: GoalInput): { ok: true; id: number } | { ok: false; reason: string } {
  if (g.accountId !== null) {
    const a = getAccount(userId, g.accountId);
    if (!a || a.source === "backtest") return { ok: false, reason: "Account not found" };
  }
  // Money goals need one currency; an account brings its own.
  const currency = GOAL_KINDS[g.kind].unit === "money" ? (g.accountId !== null ? getAccount(userId, g.accountId)!.currency : (g.currency ?? getSettings(userId).baseCurrency)) : null;
  const id = Number(db().prepare("INSERT INTO goals (user_id, kind, period, target, currency, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, g.kind, g.period, g.target, currency, g.accountId, now()).lastInsertRowid);
  return { ok: true, id };
}

export const deleteGoal = (userId: number, id: number) => Number(db().prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;

export interface ProgressOverview {
  today: string;
  streaks: { key: string; label: string; unit: string; streak: Streak; detail: string }[];
  goals: Goal[];
}

/** Streaks and goals, from live trades (sample too when asked for), the daily journal and the routine. Days are the user's zone. */
export function progressOverview(userId: number, includeSample: boolean, nowMs = Date.now()): ProgressOverview {
  const tz = getSettings(userId).timeZone || undefined;
  const today = zoneDateKey(nowMs, tz);
  const accounts = new Map(listAccounts(userId).map((a) => [a.id, a]));
  const checks = checklistTotals(userId);
  const trades = listTrades(userId, { closedOnly: true, includeSample })
    .filter((t) => t.pnl !== null && t.closedAt)
    .map((t) => {
      const c = checks.get(t.id);
      return { accountId: t.accountId, pnl: t.pnl!, closedAt: t.closedAt!, day: zoneDateKey(t.closedAt!, tz), rulesFollowed: c && c.total > 0 ? c.done === c.total : null };
    })
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const journal = listDays(userId, includeSample).map((d) => d.date);
  const routine = completeRoutineDays(routineItems(userId), routineChecks(userId));

  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.day, addMoney([byDay.get(t.day) ?? 0, t.pnl]));
  const greenDays = runStreak([...byDay.keys()].sort().map((d) => byDay.get(d)! > 0));
  const ruled = trades.filter((t) => t.rulesFollowed !== null);

  const streaks = [
    { key: "journal", label: "Journaling", unit: "days", streak: dayStreak(journal, today), detail: "Weekdays in a row with a plan or recap written." },
    { key: "routine", label: "Routine", unit: "days", streak: dayStreak(routine, today), detail: "Weekdays in a row with every routine step ticked." },
    { key: "green", label: "Green days", unit: "days", streak: greenDays, detail: "Trading days in a row that closed in profit." },
    { key: "rules", label: "Rules followed", unit: "trades", streak: runStreak(ruled.map((t) => t.rulesFollowed!)), detail: "Trades in a row with every playbook rule ticked." },
  ];

  const rows = db().prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY id").all(userId) as { id: number; kind: GoalKind; period: "week" | "month"; target: number; currency: string | null; account_id: number | null }[];
  const goals = rows.map((g): Goal => {
    const scoped = trades.filter((t) => (g.account_id === null || t.accountId === g.account_id) && (g.currency === null || accounts.get(t.accountId)?.currency === g.currency));
    const evalIn = (range: { from: string; to: string }) => {
      const within = (d: string) => d >= range.from && d <= range.to;
      return {
        ...range,
        ...evaluateGoal(
          g.kind,
          g.target,
          { trades: scoped.filter((t) => within(t.day)), journalDays: journal.filter(within).length, routineDays: [...routine].filter(within).length },
          range.to < today,
        ),
      };
    };
    return { id: g.id, kind: g.kind, period: g.period, target: g.target, accountId: g.account_id, currency: g.currency, label: GOAL_KINDS[g.kind].label, unit: GOAL_KINDS[g.kind].unit, current: evalIn(periodRange(g.period, today)), previous: evalIn(previousPeriod(g.period, today)) };
  });
  return { today, streaks, goals };
}
