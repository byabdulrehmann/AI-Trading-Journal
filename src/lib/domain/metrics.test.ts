import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computePosition } from "./engine/position";
import { HOLD_BUCKETS, R_BUCKETS, breakdownMany, bucketBreakdown, computeMetrics, computeScore, dailySummaries, holdMinutes, periodKey, periodSummaries, ramp, tradesInUnit, type Metrics } from "./metrics";
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

describe("the score, by hand", () => {
  const base = { profitFactor: 2.2, expectancy: 30, avgLoss: -75, recoveryFactor: 1.8, dayWinRate: 0.75, planAdherence: null, planSample: 0, rSample: 12, closedTrades: 20, tradingDays: 5, wins: 10, losses: 8, netPnl: 180 } as unknown as Metrics;
  const axis = (s: ReturnType<typeof computeScore>, key: string) => s.axes.find((a) => a.key === key)?.value;

  test("ramp: flat beyond the ends, straight between anchors", () => {
    const a: [number, number][] = [[1, 10], [3, 30]];
    assert.deepEqual([ramp(0, a), ramp(1, a), ramp(2, a), ramp(3, a), ramp(9, a)], [10, 10, 20, 30, 30]);
  });

  test("each axis, and the total with a blank axis sitting out", () => {
    const s = computeScore(base);
    assert.ok(Math.abs((axis(s, "profitability") as number) - 91) < 1e-9); // 2.2 between 1.5 = 70 and 2.5 = 100
    assert.ok(Math.abs((axis(s, "edge") as number) - 79) < 1e-9); // 30 / 75 = 0.4, between 0.25 = 70 and 0.75 = 100
    assert.ok(Math.abs((axis(s, "risk") as number) - 62) < 1e-9); // 1.8 between 1 = 50 and 3 = 80
    assert.equal(axis(s, "consistency"), 100); // 75% winning days is past the top anchor
    assert.equal(axis(s, "discipline"), null); // no plan answers
    assert.equal(axis(s, "stops"), 60); // 12 of 20
    assert.equal(s.score, 80); // (25x91 + 20x79 + 20x62 + 15x100 + 10x60) / 90 = 7195 / 90 = 79.94
  });

  test("discipline joins with 10 answers, and moves the total", () => {
    const s = computeScore({ ...base, planAdherence: 0.8, planSample: 10 });
    assert.ok(Math.abs((axis(s, "discipline") as number) - 60) < 1e-9);
    assert.equal(s.score, 78); // (7195 + 10x60) / 100 = 77.95
    assert.equal(axis(computeScore({ ...base, planAdherence: 0.8, planSample: 9 }), "discipline"), null);
  });

  test("no total below 20 trades or 5 days, but the axes still read", () => {
    assert.equal(computeScore({ ...base, closedTrades: 19 }).score, null);
    assert.equal(computeScore({ ...base, tradingDays: 4 }).score, null);
    assert.ok(axis(computeScore({ ...base, closedTrades: 19 }), "profitability") !== null);
  });

  test("no trades: no total, blank axes, never NaN", () => {
    const s = computeScore(computeMetrics([], UTC));
    assert.equal(s.score, null);
    assert.ok(s.axes.every((a) => a.value === null));
  });

  test("all wins can't divide by a loss, and read as the top of those axes", () => {
    const m = computeMetrics(Array.from({ length: 20 }, (_, i) => closed(`2026-03-${String((i % 5) + 2).padStart(2, "0")}T10:00:00Z`, 10, { rMultiple: 1 })), UTC);
    const s = computeScore(m);
    assert.deepEqual([axis(s, "profitability"), axis(s, "edge"), axis(s, "risk"), axis(s, "consistency"), axis(s, "stops")], [100, 100, 100, 100, 100]);
    assert.equal(s.score, 100);
  });

  test("all losses bottom out", () => {
    const m = computeMetrics(Array.from({ length: 20 }, (_, i) => closed(`2026-03-${String((i % 5) + 2).padStart(2, "0")}T10:00:00Z`, -10)), UTC);
    const s = computeScore(m);
    assert.equal(axis(s, "profitability"), 0); // profit factor 0
    assert.equal(axis(s, "edge"), 0); // -10 / 10 = -1, below the bottom anchor
    assert.equal(axis(s, "risk"), 0); // recovery -1
    assert.equal(axis(s, "consistency"), 0);
    assert.equal(s.score, 0);
  });

  test("the same results at ten times the size score the same", () => {
    const at = (x: number) => SIX().map((t) => ({ ...t, pnl: (t.pnl as number) * x }));
    assert.equal(computeScore({ ...computeMetrics(at(10), UTC), closedTrades: 20, tradingDays: 5 }).score, computeScore({ ...computeMetrics(at(1), UTC), closedTrades: 20, tradingDays: 5 }).score);
  });
});

describe("display units", () => {
  const three = () => [
    closed("2026-03-02T10:00:00Z", 100, { accountId: 1, rMultiple: 1, symbol: "EURUSD", side: "long", entryPrice: 1.1, exitPrice: 1.105 }), // 50 pips
    closed("2026-03-03T10:00:00Z", -50, { accountId: 1, rMultiple: -0.5, symbol: "XAUUSD", side: "long", entryPrice: 2000, exitPrice: 1999 }),
    closed("2026-03-04T10:00:00Z", 25, { accountId: 2, symbol: "AAPL", side: "long", entryPrice: 100, exitPrice: 101 }), // no stop, no pips
  ];
  const balances = new Map([[1, 1000], [2, 0]]);

  test("money leaves trades alone", () => {
    const t = three();
    assert.equal(tradesInUnit(t, "money").trades, t);
  });

  test("R uses each trade's R and leaves out trades with no stop", () => {
    const r = tradesInUnit(three(), "r");
    assert.equal(r.left, 1);
    assert.deepEqual(r.trades.map((t) => t.pnl), [1, -0.5]);
    assert.equal(computeMetrics(r.trades, UTC).netPnl, 0.5);
    assert.equal(computeMetrics(r.trades, UTC).maxDrawdown, 0.5);
  });

  test("percent is of the combined balance, and accounts with none are left out", () => {
    const r = tradesInUnit(three(), "percent", { balances });
    assert.equal(r.base, 1000);
    assert.equal(r.left, 1);
    assert.deepEqual(r.trades.map((t) => t.pnl), [10, -5]);
    assert.equal(computeMetrics(r.trades, UTC).netPnl, 5);
  });

  test("percent with no balance anywhere shows nothing", () => {
    assert.equal(tradesInUnit(three(), "percent", { balances: new Map() }).trades.length, 0);
  });

  test("pips: forex by its pip, metals only with digits, everything else left out", () => {
    const none = tradesInUnit(three(), "pips");
    assert.deepEqual(none.trades.map((t) => t.pnl), [50]);
    assert.equal(none.left, 2);
    const withDigits = tradesInUnit(three(), "pips", { digits: (t) => (t.symbol === "XAUUSD" ? 2 : null) });
    assert.deepEqual(withDigits.trades.map((t) => t.pnl), [50, -10]); // -1.00 at a 0.1 pip
  });

  test("open trades stay, and don't count as left out", () => {
    const r = tradesInUnit([closed("2026-03-02T10:00:00Z", 5, { status: "open", closedAt: null, pnl: null })], "r");
    assert.equal(r.trades.length, 1);
    assert.equal(r.left, 0);
  });
});
