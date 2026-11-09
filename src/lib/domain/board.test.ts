import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cumulativeByDay, daysInMonth, monthGrid, monthStats, shiftMonth, shortMoney, weekSummaries, type DayResult } from "./board";
import { computeMetrics, periodSummaries } from "./metrics";
import type { Trade } from "./types";

const inMonth = (y: number, m: number) => monthGrid(y, m).flat().filter((c) => c.inMonth).map((c) => c.day);

describe("the dashboard calendar", () => {
  test("month lengths and leap years", () => {
    assert.deepEqual([daysInMonth(2026, 2), daysInMonth(2028, 2), daysInMonth(2100, 2), daysInMonth(2000, 2), daysInMonth(2026, 4), daysInMonth(2026, 12)], [28, 29, 28, 29, 30, 31]);
    assert.equal(inMonth(2028, 2).length, 29);
    assert.equal(inMonth(2028, 2).at(-1), 29);
  });

  test("weeks start on Sunday; rows only as many as the month needs", () => {
    // February 2026 starts on a Sunday and has 28 days: exactly four rows.
    const feb = monthGrid(2026, 2);
    assert.equal(feb.length, 4);
    assert.equal(feb[0][0].key, "2026-02-01");
    // August 2026 starts on a Saturday: 1 day in the first row, six rows in all.
    const aug = monthGrid(2026, 8);
    assert.equal(aug.length, 6);
    assert.deepEqual(aug[0].map((c) => c.inMonth), [false, false, false, false, false, false, true]);
    assert.equal(aug[0][0].key, "2026-07-26");
    assert.equal(aug[5][1].key, "2026-08-31");
    // Across a year end.
    assert.equal(monthGrid(2026, 12).at(-1)!.at(-1)!.key, "2027-01-02");
  });

  test("week summaries count only that row's days in the month", () => {
    const days = new Map<string, DayResult>([
      ["2026-07-31", { pnl: 500, trades: 1, wins: 1, losses: 0 }], // outside August, in its first row
      ["2026-08-01", { pnl: 100, trades: 2, wins: 1, losses: 1 }],
      ["2026-08-03", { pnl: -40.1, trades: 1, wins: 0, losses: 1 }],
      ["2026-08-04", { pnl: 10.2, trades: 3, wins: 2, losses: 1 }],
    ]);
    const weeks = weekSummaries(monthGrid(2026, 8), days);
    assert.deepEqual(weeks.slice(0, 2), [{ index: 1, pnl: 100, days: 1, trades: 2 }, { index: 2, pnl: -29.9, days: 2, trades: 4 }]);
    assert.deepEqual(weeks.slice(2).map((w) => w.days), [0, 0, 0, 0]);
    assert.deepEqual(monthStats(2026, 8, days), { pnl: 70.1, days: 3, trades: 6 });
  });

  test("a day's cell is every trade closed that day in the chosen zone, and its totals match the trades", () => {
    const t = (closedAt: string, pnl: number, id: number) => ({ id, status: "closed", pnlStatus: "ok", pnl, closedAt, openedAt: closedAt, commission: 0, swap: 0, otherFees: 0, rMultiple: null, followedPlan: null, plannedR: null }) as unknown as Trade;
    // 02:00 UTC on 1 March is still 28 February in New York.
    const trades = [t("2026-03-01T02:00:00Z", 30, 1), t("2026-02-28T15:00:00Z", -10, 2), t("2026-03-01T15:00:00Z", 5, 3)];
    const ny = periodSummaries(trades, "day", "America/New_York");
    assert.deepEqual(ny.map((r) => [r.key, r.pnl, r.trades, r.wins, r.losses]), [["2026-02-28", 20, 2, 1, 1], ["2026-03-01", 5, 1, 1, 0]]);
    const utc = periodSummaries(trades, "day", "UTC");
    assert.deepEqual(utc.map((r) => r.key), ["2026-02-28", "2026-03-01"]);
    assert.deepEqual(utc.map((r) => r.pnl), [-10, 35]);
    // The calendar's month total equals the sum of the trades in it.
    const days = new Map(ny.map((r) => [r.key, r]));
    assert.equal(monthStats(2026, 2, days).pnl + monthStats(2026, 3, days).pnl, computeMetrics(trades, "America/New_York").netPnl);
  });

  test("months step across years", () => {
    assert.deepEqual([shiftMonth("2026-01", -1), shiftMonth("2026-12", 1), shiftMonth("2028-02", 12)], ["2025-12", "2027-01", "2029-02"]);
  });
});

describe("dashboard series", () => {
  test("cumulative P&L is the running sum of the daily rows, in day order", () => {
    const rows = [{ key: "2026-03-03", pnl: -5.1 }, { key: "2026-03-01", pnl: 10.2 }, { key: "2026-03-02", pnl: 0.1 }];
    assert.deepEqual(cumulativeByDay(rows).map((r) => [r.key, r.cum]), [["2026-03-01", 10.2], ["2026-03-02", 10.3], ["2026-03-03", 5.2]]);
  });

  test("short money", () => {
    assert.deepEqual([shortMoney(7060, "$"), shortMoney(-18123, "$"), shortMoney(906, "$"), shortMoney(-213, "$"), shortMoney(12.5, "$"), shortMoney(2_680_000, "$"), shortMoney(0, "$")], ["$7.06K", "-$18.1K", "$906", "-$213", "$12.50", "$2.68M", "$0"]);
  });
});
