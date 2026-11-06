import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computePosition } from "./engine/position";
import { HOLD_BUCKETS, R_BUCKETS, breakdownMany, bucketBreakdown, computeMetrics, dailySummaries, holdMinutes, periodKey, periodSummaries } from "./metrics";
import type { Trade } from "./types";
import { zoneDateKey, zoneInstant, zoneParts } from "./zone";

const UTC = "UTC";
let nextId = 1;

/** Only the fields metrics read. Every expected value below was worked out by hand. */
function closed(closedAt: string, pnl: number, over: Partial<Trade> = {}): Trade {
  return {
    id: nextId++,
    accountId: 1,
    symbol: "EURUSD",
    side: "long",
    status: "closed",
    pnlStatus: "ok",
    openedAt: new Date(Date.parse(closedAt) - 30 * 60000).toISOString(),
    closedAt,
    pnl,
    rMultiple: null,
    plannedR: null,
    followedPlan: null,
    commission: 0,
    swap: 0,
    otherFees: 0,
    tags: [],
    strategyTags: [],
    mistakes: [],
    ...over,
  } as Trade;
}

const SIX = () => [
  closed("2026-03-02T10:00:00Z", 100, { rMultiple: 1, plannedR: 2 }),
  closed("2026-03-02T15:00:00Z", -50, { rMultiple: -0.5, plannedR: 2 }),
  closed("2026-03-03T10:00:00Z", 200, { rMultiple: 2, plannedR: 3 }),
  closed("2026-03-04T10:00:00Z", -100, { rMultiple: -1 }),
  closed("2026-03-04T12:00:00Z", 0),
  closed("2026-03-05T10:00:00Z", 30),
];

describe("computeMetrics, by hand", () => {
  test("six trades over four days", () => {
    const m = computeMetrics(SIX(), UTC);
    assert.equal(m.closedTrades, 6);
    assert.deepEqual([m.wins, m.losses, m.breakeven], [3, 2, 1]);
    assert.equal(m.netPnl, 180); // 100 - 50 + 200 - 100 + 0 + 30
    assert.equal(m.grossProfit, 330);
    assert.equal(m.grossLoss, -150);
    assert.equal(m.profitFactor, 2.2); // 330 / 150
    assert.equal(m.winRate, 0.5); // 3 / 6
    assert.equal(m.expectancy, 30); // 180 / 6
    assert.equal(m.avgWin, 110); // 330 / 3
    assert.equal(m.avgLoss, -75); // -150 / 2
    assert.equal(m.payoffRatio, 1.47); // 110 / 75
    assert.equal(m.maxDrawdown, 100); // equity 100, 50, 250, 150, 150, 180: 250 down to 150
    assert.equal(m.recoveryFactor, 1.8); // 180 / 100
    assert.equal(m.avgPlannedR, 2.33); // (2 + 2 + 3) / 3
    assert.equal(m.avgR, 0.38); // (1 - 0.5 + 2 - 1) / 4 = 0.375
    assert.equal(m.currentStreak, 1);
  });

  test("days: +50, +200, -100, +30", () => {
    const m = computeMetrics(SIX(), UTC);
    assert.deepEqual([m.tradingDays, m.winningDays, m.losingDays], [4, 3, 1]);
    assert.equal(m.dayWinRate, 0.75);
    assert.equal(m.avgDailyPnl, 45); // 180 / 4
    assert.deepEqual(m.bestDay, { date: "2026-03-03", pnl: 200 });
    assert.deepEqual(m.worstDay, { date: "2026-03-04", pnl: -100 });
  });

  test("no trades: zeros and blanks, never NaN", () => {
    const m = computeMetrics([], UTC);
    assert.equal(m.netPnl, 0);
    for (const v of [m.winRate, m.profitFactor, m.expectancy, m.avgWin, m.avgLoss, m.payoffRatio, m.recoveryFactor, m.avgPlannedR, m.dayWinRate, m.avgDailyPnl, m.bestDay, m.worstDay]) assert.equal(v, null);
    assert.deepEqual([m.currentStreak, m.tradingDays, m.maxDrawdown], [0, 0, 0]);
  });

  test("all wins: no profit factor to divide, no drawdown", () => {
    const m = computeMetrics([closed("2026-03-02T10:00:00Z", 10), closed("2026-03-03T10:00:00Z", 20)], UTC);
    assert.equal(m.winRate, 1);
    assert.equal(m.profitFactor, null);
    assert.equal(m.payoffRatio, null);
    assert.equal(m.recoveryFactor, null);
    assert.equal(m.maxDrawdown, 0);
    assert.equal(m.currentStreak, 2);
  });

  test("all losses: profit factor 0, drawdown is the whole loss, streak negative", () => {
    const m = computeMetrics([closed("2026-03-02T10:00:00Z", -10), closed("2026-03-03T10:00:00Z", -20)], UTC);
    assert.equal(m.winRate, 0);
    assert.equal(m.profitFactor, 0);
    assert.equal(m.maxDrawdown, 30);
    assert.equal(m.recoveryFactor, -1);
    assert.equal(m.currentStreak, -2);
    assert.equal(m.dayWinRate, 0);
  });

  test("a breakeven last trade resets the streak", () => {
    assert.equal(computeMetrics([closed("2026-03-02T10:00:00Z", 10), closed("2026-03-03T10:00:00Z", 0)], UTC).currentStreak, 0);
  });

  test("open and unpriced trades stay out of every result", () => {
    const m = computeMetrics([closed("2026-03-02T10:00:00Z", 10), closed("2026-03-03T10:00:00Z", 999, { status: "partial" }), closed("2026-03-04T10:00:00Z", 999, { pnlStatus: "needs_rate" })], UTC);
    assert.equal(m.netPnl, 10);
    assert.equal(m.closedTrades, 1);
    assert.equal(m.openTrades, 1);
    assert.equal(m.excludedTrades, 1);
  });

  test("fees add up across costs, and a credit lowers them", () => {
    const m = computeMetrics([closed("2026-03-02T10:00:00Z", 10, { commission: 3.5, swap: -1.25, otherFees: 0.1 }), closed("2026-03-03T10:00:00Z", 10, { commission: 0.2 })], UTC);
    assert.equal(m.totalFees, 2.55);
  });
});

describe("the engine's results for the cases metrics rely on", () => {
  const base = { symbol: "AAPL C190", accountCurrency: "USD", profitCurrency: "USD", fxRate: null, swap: 0, otherFees: 0, stopPrice: null, targetPrice: null, brokerProfit: null };

  test("options use the 100 multiplier, and costs come off", () => {
    // Long 2 contracts, 4.20 to 5.70: 1.50 x 2 x 100 = 300 gross, less 2.60 commission.
    const r = computePosition({ ...base, side: "long", contractSize: 100, entries: [{ price: 4.2, qty: 2 }], exits: [{ price: 5.7, qty: 2 }], commission: 2.6 });
    assert.equal(r.grossPnl, 300);
    assert.equal(r.netPnl, 297.4);
  });

  test("a short option profits when the premium falls", () => {
    // Short 1 contract, 6.00 to 4.50: 1.50 x 1 x 100 = 150.
    const r = computePosition({ ...base, side: "short", contractSize: 100, entries: [{ price: 6, qty: 1 }], exits: [{ price: 4.5, qty: 1 }], commission: 0 });
    assert.equal(r.netPnl, 150);
  });

  test("partial fills average, and the trade only closes when flat", () => {
    // Long 100 at 10. Out 40 at 11 and 60 at 12: average exit 11.60, gross 160, net 155.
    const full = computePosition({ ...base, side: "long", contractSize: 1, entries: [{ price: 10, qty: 100 }], exits: [{ price: 11, qty: 40 }, { price: 12, qty: 60 }], commission: 5 });
    assert.equal(full.status, "closed");
    assert.equal(full.avgExit, 11.6);
    assert.equal(full.netPnl, 155);
    const part = computePosition({ ...base, side: "long", contractSize: 1, entries: [{ price: 10, qty: 100 }], exits: [{ price: 11, qty: 40 }], commission: 5 });
    assert.equal(part.status, "partial");
    assert.equal(part.remainingQty, 60);
  });
});

describe("breakdowns", () => {
  test("a trade with two tags counts in both", () => {
    const rows = breakdownMany([closed("2026-03-02T10:00:00Z", 100, { tags: ["a", "b"] }), closed("2026-03-03T10:00:00Z", -40, { tags: ["b"] }), closed("2026-03-04T10:00:00Z", 5)], (t) => t.tags);
    assert.deepEqual(rows.map((r) => [r.key, r.trades, r.netPnl, r.winRate]), [["a", 1, 100, 1], ["b", 2, 60, 0.5]]);
  });

  test("a duplicate key on one trade counts once", () => {
    assert.equal(breakdownMany([closed("2026-03-02T10:00:00Z", 1, { tags: ["a", "a"] })], (t) => t.tags)[0].trades, 1);
  });

  test("hold bands: the lower edge belongs to the band, the upper to the next", () => {
    const at = (min: number, pnl: number) => closed("2026-03-02T10:00:00Z", pnl, { openedAt: new Date(Date.parse("2026-03-02T10:00:00Z") - min * 60000).toISOString() });
    const rows = bucketBreakdown([at(3, 1), at(5, 2), at(15, 4), at(1440, 8)], holdMinutes, HOLD_BUCKETS);
    assert.deepEqual(rows.map((r) => [r.key, r.netPnl]), [["Under 5 min", 1], ["5 to 15 min", 2], ["15 to 60 min", 4], ["A day or more", 8]]);
  });

  test("R bands skip trades with no R, and -1R lands in the -1R to 0R band", () => {
    const rows = bucketBreakdown([closed("2026-03-02T10:00:00Z", -10, { rMultiple: -1 }), closed("2026-03-03T10:00:00Z", 5)], (t) => t.rMultiple, R_BUCKETS);
    assert.deepEqual(rows.map((r) => [r.key, r.trades]), [["−1R to 0R", 1]]);
  });
});

describe("time zones", () => {
  const NY = "America/New_York";

  test("parts of an instant", () => {
    assert.deepEqual(zoneParts(Date.parse("2026-07-01T02:30:00Z"), NY), { year: 2026, month: 6, day: 30, hour: 22, minute: 30, weekday: 2 });
    assert.deepEqual(zoneParts(Date.parse("2026-07-01T20:15:00Z"), "Asia/Karachi"), { year: 2026, month: 7, day: 2, hour: 1, minute: 15, weekday: 4 });
    assert.equal(zoneDateKey("2026-07-01T02:30:00Z", UTC), "2026-07-01");
  });

  test("midnights either side of the spring clock change are 23 hours apart", () => {
    const start = zoneInstant(2026, 3, 8, 0, 0, NY);
    const next = zoneInstant(2026, 3, 9, 0, 0, NY);
    assert.equal(new Date(start).toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(new Date(next).toISOString(), "2026-03-09T04:00:00.000Z");
  });

  test("a day past the end of the month overflows", () => {
    assert.equal(new Date(zoneInstant(2026, 1, 32, 0, 0, UTC)).toISOString(), "2026-02-01T00:00:00.000Z");
  });

  test("the same trade lands on a different day in a different zone", () => {
    const t = closed("2026-07-01T02:30:00Z", 10);
    assert.deepEqual([...dailySummaries([t], UTC).keys()], ["2026-07-01"]);
    assert.deepEqual([...dailySummaries([t], NY).keys()], ["2026-06-30"]);
    assert.equal(periodSummaries([t], "month", NY)[0].key, "2026-06");
    assert.equal(periodSummaries([t], "month", UTC)[0].key, "2026-07");
  });

  test("weeks start on Monday, in the chosen zone", () => {
    assert.equal(periodKey("2026-03-08T12:00:00Z", "week", UTC), "2026-03-02"); // a Sunday
    assert.equal(periodKey("2026-03-09T02:00:00Z", "week", UTC), "2026-03-09"); // Monday in UTC
    assert.equal(periodKey("2026-03-09T02:00:00Z", "week", NY), "2026-03-02"); // still Sunday in New York
  });
});
