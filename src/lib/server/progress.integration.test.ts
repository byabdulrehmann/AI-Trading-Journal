import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-progress-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const R = await import("./repo/mt5");
const { updateSettings } = await import("./repo/settings");
const { encrypt } = await import("./mt5/crypto");
const P = await import("./progress");
const { TradeInput } = await import("@/lib/domain/types");

let owner = 0;
let other = 0;
let main = 0;
let practice = 0;
const NOW = Date.parse("2026-03-03T12:00:00Z");

const trade = (closedAt: string, exitPrice: number) =>
  J.createTrade(owner, TradeInput.parse({ accountId: main, symbol: "AAPL", side: "long", openedAt: closedAt.replace("T1", "T0"), closedAt, entryPrice: 100, exitPrice, quantity: 1 }));

const rules = { name: "Step one", firm: "Example firm", startDate: "2026-03-02", accountSize: 10000, profitTarget: 1000, dailyLoss: 500, maxLoss: 1000 };

before(async () => {
  db();
  owner = ((await createUser("p@example.test", "correct horse battery", "P")) as { id: number }).id;
  other = ((await createUser("q@example.test", "correct horse battery", "Q")) as { id: number }).id;
  updateSettings(owner, { timeZone: "UTC" });
  main = J.createAccount(owner, { name: "Prop", broker: "", currency: "USD", startingBalance: 10000 }).id;
  practice = J.createAccount(owner, { name: "Practice", broker: "", currency: "USD", startingBalance: 0 }, { source: "backtest" }).id;
  trade("2026-02-27T15:00:00.000Z", 1000); // before the start: doesn't count
  trade("2026-03-02T15:00:00.000Z", 500); // +400
  trade("2026-03-03T10:00:00.000Z", -200); // -300
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

describe("prop challenges", () => {
  let id = 0;

  test("rules are checked on the account's own trades in the window", () => {
    const r = P.createChallenge(owner, P.ChallengeInput.parse({ ...rules, accountId: main }));
    assert.ok(r.ok);
    id = r.challenge.id;
    const c = P.getChallenge(owner, id, NOW)!;
    assert.deepEqual([c.result.status, c.result.profit, c.result.tradingDays, c.result.today.loss, c.result.today.left, c.floatingAt], ["active", 100, 2, 300, 200, null]);
    assert.equal(P.challengeAlerts(owner, false).length, 0);
  });

  test("the floating loss from today's MT5 sync counts, and breaches the daily limit", () => {
    R.saveConnection(main, "1", "Demo", encrypt("pw"));
    db().prepare("UPDATE mt5_connections SET floating_pnl = -250, snapshot_at = ? WHERE account_id = ?").run("2026-03-03T11:59:00.000Z", main);
    const c = P.getChallenge(owner, id, NOW)!;
    assert.deepEqual([c.result.status, c.result.breach?.rule, c.result.today.loss, c.floatingAt], ["failed", "daily", 550, "2026-03-03T11:59:00.000Z"]);
    // A snapshot from another trading day is stale: left out.
    assert.equal(P.getChallenge(owner, id, Date.parse("2026-03-04T12:00:00Z"))!.floatingAt, null);
  });

  test("not on a backtest account, and another user can't see or touch it", () => {
    const r = P.createChallenge(owner, P.ChallengeInput.parse({ ...rules, accountId: practice }));
    assert.equal(r.ok, false);
    assert.equal(P.createChallenge(other, P.ChallengeInput.parse({ ...rules, accountId: main })).ok, false);
    assert.equal(P.getChallenge(other, id), null);
    assert.equal(P.listChallenges(other, true).length, 0);
    assert.equal(P.deleteChallenge(other, id), false);
    assert.equal(P.updateChallenge(other, id, P.ChallengeInput.parse({ ...rules, accountId: main })).ok, false);
  });

  test("an end before the start, or a max loss as big as the account, is refused", () => {
    assert.equal(P.ChallengeInput.safeParse({ ...rules, accountId: main, endDate: "2026-03-01" }).success, false);
    assert.equal(P.ChallengeInput.safeParse({ ...rules, accountId: main, maxLoss: 10000 }).success, false);
  });

  test("spending: kept per currency, and kept when its challenge is deleted", () => {
    const add = (kind: string, amount: number, currency = "USD") => P.createExpense(owner, P.ExpenseInput.parse({ date: "2026-03-01", kind, amount, currency, firm: "Example firm", challengeId: id }));
    add("fee", 99);
    add("reset", 50);
    add("payout", 400);
    add("fee", 80, "EUR");
    const usd = P.spendingSummary(P.listExpenses(owner)).find((s) => s.currency === "USD")!;
    assert.deepEqual([usd.spent, usd.received, usd.net], [149, 400, 251]);
    assert.equal(P.spendingSummary(P.listExpenses(owner)).find((s) => s.currency === "EUR")!.net, -80);
    assert.equal(P.createExpense(other, P.ExpenseInput.parse({ date: "2026-03-01", kind: "fee", amount: 1, currency: "USD", challengeId: id })).ok, false);
    assert.ok(P.deleteChallenge(owner, id));
    assert.ok(P.listExpenses(owner).every((e) => e.challengeId === null));
    assert.equal(P.listExpenses(other).length, 0);
  });
});

describe("routine, streaks and goals", () => {
  test("ticking every step completes the day; a future day can't be ticked", () => {
    const a = P.addRoutineItem(owner, "Check the news calendar");
    const b = P.addRoutineItem(owner, "Mark the levels");
    const today = P.todayFor(owner);
    assert.ok(P.setRoutineCheck(owner, { date: today, itemId: a.id, checked: true }).ok);
    assert.equal(P.setRoutineCheck(owner, { date: "2999-01-01", itemId: a.id, checked: true }).ok, false);
    assert.equal(P.setRoutineCheck(other, { date: today, itemId: a.id, checked: true }).ok, false);
    const routine = () => P.progressOverview(owner, false).streaks.find((s) => s.key === "routine")!.streak.current;
    const weekday = ![0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay());
    assert.equal(routine(), 0);
    P.setRoutineCheck(owner, { date: today, itemId: b.id, checked: true });
    assert.equal(routine(), weekday ? 1 : 0);
    // Retiring a step keeps the day it was done complete.
    P.updateRoutineItem(owner, b.id, { archived: true });
    assert.equal(routine(), weekday ? 1 : 0);
    assert.deepEqual(P.routineDay(owner, today).items.map((i) => i.label), ["Check the news calendar"]);
  });

  test("a weekly goal counts this week's trades, and last week's separately", () => {
    assert.ok(P.createGoal(owner, P.GoalInput.parse({ kind: "net_pnl", period: "week", target: 500 })).ok);
    const g = P.progressOverview(owner, false, NOW).goals[0];
    assert.deepEqual([g.current.from, g.current.value, g.current.state, g.currency], ["2026-03-02", 100, "behind", "USD"]);
    assert.deepEqual([g.previous.from, g.previous.value, g.previous.state], ["2026-02-23", 900, "met"]);
    assert.equal(P.progressOverview(other, false, NOW).goals.length, 0);
    assert.equal(P.deleteGoal(other, g.id), false);
  });

  test("delete everything clears it all", () => {
    J.deleteAllData(owner);
    for (const t of ["challenges", "prop_expenses", "routine_items", "routine_checks", "goals"]) assert.equal((db().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(owner) as { n: number }).n, 0, t);
  });
});
