import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { completeRoutineDays, dayStreak, evaluateChallenge, evaluateGoal, periodRange, runStreak, tradingDay, type ChallengeRules, type ChallengeTrade } from "./progress";

const rules = (r: Partial<ChallengeRules> = {}): ChallengeRules => ({
  accountSize: 10000,
  profitTarget: 1000,
  dailyLoss: 500,
  maxLoss: 1000,
  maxLossType: "static",
  minDays: 0,
  consistencyPct: null,
  startDate: "2026-03-02",
  endDate: null,
  ...r,
});
let id = 0;
const t = (day: string, pnl: number, hour = 10): ChallengeTrade => ({ id: ++id, pnl, day, closedAt: `${day}T${String(hour).padStart(2, "0")}:00:00Z` });

describe("trading days", () => {
  test("a 17:00 reset moves the evening into the next day; midnight changes nothing", () => {
    const at = Date.parse("2026-03-02T22:30:00Z"); // 17:30 in New York
    assert.equal(tradingDay(at, "America/New_York", 17), "2026-03-03");
    assert.equal(tradingDay(at, "America/New_York", 0), "2026-03-02");
    assert.equal(tradingDay(Date.parse("2026-03-02T21:30:00Z"), "America/New_York", 17), "2026-03-02");
  });
});

describe("prop challenge", () => {
  test("passes at the target with enough days, and the numbers add up", () => {
    const r = evaluateChallenge(rules({ minDays: 3 }), [t("2026-03-02", 400), t("2026-03-03", -100), t("2026-03-04", 750)], "2026-03-04", null);
    assert.deepEqual([r.status, r.balance, r.profit, r.tradingDays, r.floor], ["passed", 11050, 1050, 3, 9000]);
  });

  test("not passed while days are short, even at the target", () => {
    const r = evaluateChallenge(rules({ minDays: 4 }), [t("2026-03-02", 1200)], "2026-03-02", null);
    assert.equal(r.status, "active");
    assert.equal(r.rules.find((x) => x.key === "days")?.detail, "3 more days needed.");
  });

  test("a day that dipped past the daily limit and recovered is still a breach", () => {
    const r = evaluateChallenge(rules(), [t("2026-03-02", -300, 9), t("2026-03-02", -250, 10), t("2026-03-02", 700, 11)], "2026-03-03", null);
    assert.equal(r.status, "failed");
    assert.deepEqual([r.breach?.rule, r.breach?.day], ["daily", "2026-03-02"]);
  });

  test("the daily limit counts from the day's start balance, not the account size", () => {
    // Up 800 on Monday; Tuesday loses 450 from 10800: under 500, no breach, though the account is only 350 up.
    const r = evaluateChallenge(rules(), [t("2026-03-02", 800), t("2026-03-03", -450)], "2026-03-03", null);
    assert.equal(r.status, "active");
    const daily = r.rules.find((x) => x.key === "daily")!;
    assert.deepEqual([daily.value, daily.state, daily.detail], [450, "warn", "50 left today."]);
  });

  test("open positions count today: floating loss can breach, and equity can fall to the floor", () => {
    const daily = evaluateChallenge(rules(), [t("2026-03-02", -200)], "2026-03-02", -300);
    assert.deepEqual([daily.status, daily.breach?.rule, daily.today.loss, daily.equity], ["failed", "daily", 500, 9500]);
    const max = evaluateChallenge(rules({ dailyLoss: null }), [t("2026-03-02", -700)], "2026-03-03", -300);
    assert.deepEqual([max.status, max.breach?.rule], ["failed", "max"]);
  });

  test("a trailing floor follows the high balance up and stops at the starting size", () => {
    const tr = rules({ maxLossType: "trailing", dailyLoss: null, profitTarget: null });
    const up = evaluateChallenge(tr, [t("2026-03-02", 600)], "2026-03-02", null);
    assert.equal(up.floor, 9600);
    const capped = evaluateChallenge(tr, [t("2026-03-02", 1500), t("2026-03-03", -1200)], "2026-03-03", null);
    // Peak 11500 would put the floor at 10500; it stops at 10000. Balance 10300 is above it.
    assert.deepEqual([capped.floor, capped.status], [10000, "active"]);
    // From a 10600 high the floor is 9600: a 1050 loss breaks it, though a static floor would sit at 9000.
    const broke = evaluateChallenge(tr, [t("2026-03-02", 600), t("2026-03-03", -1050)], "2026-03-03", null);
    assert.deepEqual([broke.status, broke.breach?.rule], ["failed", "max"]);
  });

  test("a limit reached exactly is a breach", () => {
    const r = evaluateChallenge(rules(), [t("2026-03-02", -500)], "2026-03-02", null);
    assert.equal(r.breach?.rule, "daily");
  });

  test("consistency: one big day blocks the pass until other days catch up", () => {
    const c = rules({ consistencyPct: 50 });
    const one = evaluateChallenge(c, [t("2026-03-02", 900), t("2026-03-03", 200)], "2026-03-03", null);
    assert.equal(one.status, "active");
    assert.equal(one.rules.find((x) => x.key === "consistency")?.state, "warn");
    const two = evaluateChallenge(c, [t("2026-03-02", 600), t("2026-03-03", 600)], "2026-03-03", null);
    assert.equal(two.status, "passed");
  });

  test("trades before the start or after the end don't count; past the end it's expired", () => {
    const r = evaluateChallenge(rules({ endDate: "2026-03-06" }), [t("2026-02-27", -900), t("2026-03-03", 300), t("2026-03-09", 900)], "2026-03-10", null);
    assert.deepEqual([r.status, r.profit], ["expired", 300]);
  });
});

describe("streaks", () => {
  test("weekends neither count nor break a run; today still to come doesn't break it", () => {
    // Thu, Fri, Mon, Tue. Today is Wednesday with nothing yet.
    const s = dayStreak(["2026-03-05", "2026-03-06", "2026-03-09", "2026-03-10"], "2026-03-11");
    assert.deepEqual(s, { current: 4, best: 4 });
  });

  test("a missed weekday ends the run; best keeps the longest", () => {
    // Today is Wednesday the 11th and Tuesday was missed.
    const s = dayStreak(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-09"], "2026-03-11");
    assert.deepEqual(s, { current: 0, best: 3 });
  });

  test("runs of results", () => {
    assert.deepEqual(runStreak([true, true, false, true, true, true, false, true]), { current: 1, best: 3 });
  });

  test("a routine day is complete when every item that existed that day was ticked", () => {
    const items = [{ id: 1, from: "2026-03-01", until: null }, { id: 2, from: "2026-03-04", until: null }, { id: 3, from: "2026-03-01", until: "2026-03-03" }];
    const checks = new Map([
      ["2026-03-02", new Set([1, 3])],
      ["2026-03-03", new Set([1])],
      ["2026-03-04", new Set([1])],
      ["2026-03-05", new Set([1, 2])],
    ]);
    assert.deepEqual([...completeRoutineDays(items, checks)], ["2026-03-02", "2026-03-03", "2026-03-05"]);
  });
});

describe("goals", () => {
  test("weeks start on Monday; months end on their last day", () => {
    assert.deepEqual(periodRange("week", "2026-03-08"), { from: "2026-03-02", to: "2026-03-08" });
    assert.deepEqual(periodRange("month", "2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
  });

  const tr = (day: string, pnl: number, rulesFollowed: boolean | null = null) => ({ day, pnl, rulesFollowed });
  const none = { journalDays: 0, routineDays: 0 };

  test("a target is behind until reached, and missed once the period ends short", () => {
    const d = { ...none, trades: [tr("2026-03-02", 300), tr("2026-03-03", -100)] };
    assert.deepEqual(evaluateGoal("net_pnl", 500, d, false), { value: 200, state: "behind", progress: 0.4, detail: "Not reached yet." });
    assert.equal(evaluateGoal("net_pnl", 500, d, true).state, "missed");
    assert.equal(evaluateGoal("net_pnl", 150, d, false).state, "met");
  });

  test("a limit holds until broken", () => {
    const d = { ...none, trades: [tr("2026-03-02", -150), tr("2026-03-02", -100), tr("2026-03-03", -200)] };
    assert.deepEqual([evaluateGoal("max_day_loss", 300, d, false).state, evaluateGoal("max_day_loss", 300, d, false).value], ["on_track", 250]);
    assert.equal(evaluateGoal("max_day_loss", 200, d, false).state, "missed");
    assert.equal(evaluateGoal("max_trades_day", 2, d, true).state, "met");
    assert.equal(evaluateGoal("max_trades_day", 1, d, false).state, "missed");
  });

  test("win rate leaves breakeven out; rules counts only trades with a checklist", () => {
    const d = { ...none, trades: [tr("2026-03-02", 100, true), tr("2026-03-02", 0, false), tr("2026-03-03", -50, null), tr("2026-03-03", 80, true)] };
    assert.equal(evaluateGoal("win_rate", 60, d, false).value, 66.67);
    assert.equal(evaluateGoal("rules_followed", 80, d, false).value, 66.67);
    assert.equal(evaluateGoal("win_rate", 60, { ...none, trades: [] }, false).state, "no_data");
  });
});
