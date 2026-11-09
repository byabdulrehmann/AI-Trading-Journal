import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computePosition } from "./engine/position";
import { HOLD_BUCKETS, R_BUCKETS, breakdownMany, bucketBreakdown, computeMetrics, computeScore, dailySummaries, holdMinutes, compareMetrics, excursionStats, excursions, missedSummary, replayPnl, timeframeFor, periodKey, periodSummaries, playbookStats, ramp, riskReport, streakRuns, tradesInUnit, winLossProfile, type Metrics } from "./metrics";
import { MissedInput, PLAYBOOK_TEMPLATES, PlaybookInput, missedR } from "./playbooks";
import { simulatedBars } from "./bars";
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

describe("the Jarvis Performance Score, by hand", () => {
  // Worked in docs/performance-score.md.
  const base = { winRate: 0.5, profitFactor: 2.2, payoffRatio: 1.5, recoveryFactor: 1.8, maxDrawdown: 300, avgLoss: -75, wins: 10, losses: 8, closedTrades: 20, tradingDays: 5, winningDays: 3, bestDay: { date: "2026-03-02", pnl: 200 }, winningDaysPnl: 500, netPnl: 180 } as unknown as Metrics;
  const axis = (s: ReturnType<typeof computeScore>, key: string) => s.axes.find((a) => a.key === key)?.value;
  const near = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

  test("ramp: flat beyond the ends, straight between anchors", () => {
    const a: [number, number][] = [[1, 10], [3, 30]];
    assert.deepEqual([ramp(0, a), ramp(1, a), ramp(2, a), ramp(3, a), ramp(9, a)], [10, 10, 20, 30, 30]);
    const down: [number, number][] = [[1, 100], [3, 80]];
    assert.deepEqual([ramp(0, down), ramp(2, down), ramp(5, down)], [100, 90, 80]);
  });

  test("the six axes in order, each from its anchors, and the weighted total", () => {
    const s = computeScore(base);
    assert.deepEqual(s.axes.map((a) => a.label), ["Win %", "Profit factor", "Avg win/loss", "Recovery factor", "Max drawdown", "Consistency"]);
    assert.equal(s.axes.reduce((t, a) => t + a.weight, 0), 100);
    near(axis(s, "winRate"), 75); // 50% between 40% = 50 and 60% = 100
    near(axis(s, "profitFactor"), 91); // 2.2 between 1.5 = 70 and 2.5 = 100
    near(axis(s, "avgWinLoss"), 57.5); // 1.5 between 1 = 40 and 2 = 75
    near(axis(s, "recoveryFactor"), 62); // 1.8 between 1 = 50 and 3 = 80
    near(axis(s, "maxDrawdown"), 70); // 300 / 75 = 4 losses deep, between 3 = 80 and 6 = 50
    near(axis(s, "consistency"), 57.5); // best day 200 of 500 = 40%, between 30% = 75 and 50% = 40
    assert.equal(s.score, 69.6); // (15x75 + 20x91 + 15x57.5 + 20x62 + 15x70 + 15x57.5) / 100
    near(s.axes.find((a) => a.key === "maxDrawdown")?.raw, 4);
  });

  test("a blank axis sits out, and the rest are reweighted", () => {
    const s = computeScore({ ...base, recoveryFactor: null, netPnl: -10 } as Metrics);
    assert.equal(axis(s, "recoveryFactor"), null);
    assert.equal(s.score, Math.round(((6960 - 20 * 62) / 80) * 100) / 100); // 71.5
  });

  test("no total below 20 trades or 5 days, but the axes still read", () => {
    assert.equal(computeScore({ ...base, closedTrades: 19 }).score, null);
    assert.equal(computeScore({ ...base, tradingDays: 4 }).score, null);
    assert.ok(axis(computeScore({ ...base, closedTrades: 19 }), "profitFactor") !== null);
  });

  test("no trades: no total, blank axes, never NaN", () => {
    const s = computeScore(computeMetrics([], UTC));
    assert.equal(s.score, null);
    assert.ok(s.axes.every((a) => a.value === null));
  });

  test("all wins can't divide by a loss, and read as the top of those axes", () => {
    const m = computeMetrics(Array.from({ length: 20 }, (_, i) => closed(`2026-03-${String((i % 5) + 2).padStart(2, "0")}T10:00:00Z`, 10, { rMultiple: 1 })), UTC);
    const s = computeScore(m);
    assert.deepEqual([axis(s, "winRate"), axis(s, "profitFactor"), axis(s, "avgWinLoss"), axis(s, "recoveryFactor"), axis(s, "maxDrawdown")], [100, 100, 100, 100, 100]);
    near(axis(s, "consistency"), 75 + ((0.2 - 0.3) / (0.15 - 0.3)) * 25); // five equal days: best is 20%
    assert.ok((s.score as number) > 95);
  });

  test("all losses bottom out", () => {
    const m = computeMetrics(Array.from({ length: 20 }, (_, i) => closed(`2026-03-${String((i % 5) + 2).padStart(2, "0")}T10:00:00Z`, -10)), UTC);
    const s = computeScore(m);
    assert.equal(axis(s, "winRate"), 0);
    assert.equal(axis(s, "profitFactor"), 0); // profit factor 0
    assert.equal(axis(s, "avgWinLoss"), null); // no wins: there's no average win
    assert.equal(axis(s, "recoveryFactor"), 0); // -200 / 200 = -1
    assert.equal(axis(s, "maxDrawdown"), 0); // 200 / 10 = 20 losses deep
    assert.equal(axis(s, "consistency"), 0); // no winning day
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

describe("playbook figures, by hand", () => {
  const trades = () => {
    const a = closed("2026-03-02T10:00:00Z", 100, { id: 1, rMultiple: 1 });
    const b = closed("2026-03-03T10:00:00Z", -50, { id: 2, rMultiple: -0.5 });
    const c = closed("2026-03-04T10:00:00Z", 30, { id: 3, rMultiple: 0.3 });
    const d = closed("2026-03-05T10:00:00Z", -20, { id: 4 });
    const open = closed("2026-03-06T10:00:00Z", 0, { id: 5, status: "open", closedAt: null, pnl: null });
    return [a, b, c, d, open];
  };
  const checks = new Map([
    [1, { done: 5, total: 5 }], // every rule
    [2, { done: 3, total: 5 }], // missed two
    [3, { done: 4, total: 4 }], // every rule, from before a fifth rule was added
    [5, { done: 1, total: 5 }], // open, reviewed
  ]);

  test("results use closed trades", () => {
    const s = playbookStats(trades(), checks);
    assert.deepEqual([s.closed, s.wins, s.losses, s.netPnl], [4, 2, 2, 60]); // 100 - 50 + 30 - 20
    assert.equal(s.winRate, 0.5);
    assert.ok(Math.abs((s.profitFactor as number) - 130 / 70) < 0.01);
    assert.equal(s.expectancy, 15); // 60 / 4
    assert.equal(s.avgR, 0.27); // (1 - 0.5 + 0.3) / 3 = 0.2667
    assert.equal(s.rSample, 3);
  });

  test("adherence adds up answers, open trades included, and leaves out trades not reviewed", () => {
    const s = playbookStats(trades(), checks);
    assert.equal(s.adherence, 13 / 19); // (5 + 3 + 4 + 1) / (5 + 5 + 4 + 5)
    assert.equal(s.reviewed, 3); // closed and reviewed
    assert.equal(s.openReviewed, 1);
  });

  test("following every rule against missing one: closed, reviewed trades only", () => {
    const s = playbookStats(trades(), checks);
    assert.deepEqual([s.onRule?.trades, s.onRule?.netPnl, s.onRule?.winRate], [2, 130, 1]); // 100 + 30
    assert.deepEqual([s.offRule?.trades, s.offRule?.netPnl, s.offRule?.winRate], [1, -50, 0]);
  });

  test("nothing reviewed, and no trades at all", () => {
    const s = playbookStats(trades(), new Map());
    assert.deepEqual([s.adherence, s.onRule, s.offRule, s.reviewed], [null, null, null, 0]);
    const none = playbookStats([], new Map());
    assert.deepEqual([none.closed, none.netPnl, none.winRate, none.profitFactor, none.adherence], [0, 0, null, null, null]);
  });

  test("a reviewed trade with every box empty counts as missed, not as unanswered", () => {
    const s = playbookStats([closed("2026-03-02T10:00:00Z", 10, { id: 9 })], new Map([[9, { done: 0, total: 3 }]]));
    assert.equal(s.adherence, 0);
    assert.equal(s.offRule?.trades, 1);
  });

  test("missed trades add up in R, skipping those with no R", () => {
    assert.deepEqual(missedSummary([{ r: 2 }, { r: -1 }, { r: null }]), { count: 3, rSample: 2, totalR: 1, avgR: 0.5 });
    assert.deepEqual(missedSummary([]), { count: 0, rSample: 0, totalR: 0, avgR: null });
  });

  test("a missed trade's R, both ways", () => {
    assert.equal(missedR({ side: "long", entryPrice: 100, stopPrice: 98, exitPrice: 106 }), 3); // +6 on 2 of risk
    assert.equal(missedR({ side: "short", entryPrice: 100, stopPrice: 102, exitPrice: 106 }), -3);
    assert.equal(missedR({ side: "long", entryPrice: 100, stopPrice: null, exitPrice: 106 }), null);
    assert.equal(missedR({ side: "long", entryPrice: 100, stopPrice: 98, exitPrice: null }), null);
  });

  test("a stop on the wrong side is refused, and every template is valid", () => {
    assert.equal(MissedInput.safeParse({ symbol: "A", side: "long", at: "2026-03-02T10:00:00Z", entryPrice: 100, stopPrice: 101 }).success, false);
    assert.equal(MissedInput.safeParse({ symbol: "A", side: "short", at: "2026-03-02T10:00:00Z", entryPrice: 100, stopPrice: 99 }).success, false);
    assert.ok(PLAYBOOK_TEMPLATES.length >= 5);
    for (const t of PLAYBOOK_TEMPLATES) assert.ok(PlaybookInput.safeParse(t).success, t.name);
    assert.equal(new Set(PLAYBOOK_TEMPLATES.map((t) => t.name)).size, PLAYBOOK_TEMPLATES.length);
  });
});

describe("reports, by hand", () => {
  const at = (day: number, pnl: number, over: Partial<Trade> = {}) => closed(`2026-03-${String(day).padStart(2, "0")}T10:00:00Z`, pnl, over);

  test("winners against losers", () => {
    const r = winLossProfile([at(2, 100), at(3, 300), at(4, 50), at(5, -40), at(6, -80), at(7, 0)]);
    assert.deepEqual([r.wins.trades, r.wins.total, r.wins.avg, r.wins.median, r.wins.largest], [3, 450, 150, 100, 300]);
    assert.deepEqual([r.losses.trades, r.losses.total, r.losses.avg, r.losses.median, r.losses.largest], [2, -120, -60, -60, -80]);
    assert.equal(r.wins.avgHoldMin, 30);
  });

  test("no trades on a side leaves blanks", () => {
    const r = winLossProfile([at(2, 100)]);
    assert.deepEqual([r.losses.trades, r.losses.total, r.losses.avg, r.losses.median, r.losses.largest, r.losses.avgHoldMin], [0, 0, null, null, null, null]);
  });

  test("streak runs: W W L W W W L L, then a breakeven splits two wins", () => {
    const pnls = [10, 10, -5, 10, 10, 10, -5, -5, 10, 0, 10];
    const rows = streakRuns(pnls.map((p, i) => at(i + 2, p)));
    assert.deepEqual(rows, [
      { length: 1, wins: 2, losses: 1 }, // the two wins around the breakeven, and one lone loss
      { length: 2, wins: 1, losses: 1 },
      { length: 3, wins: 1, losses: 0 },
    ]);
  });

  test("streak runs go by closing order, not list order", () => {
    assert.deepEqual(streakRuns([at(4, 10), at(2, 10), at(3, -5)]), [{ length: 1, wins: 2, losses: 1 }]);
  });

  test("no trades, no runs", () => {
    assert.deepEqual(streakRuns([]), []);
  });

  test("risk: stops, planned against actual, and what going past the stop cost", () => {
    const r = riskReport([
      at(2, 200, { rMultiple: 2, riskAmount: 100, plannedR: 3 }),
      at(3, -100, { rMultiple: -1, riskAmount: 100, grossPnl: -100, plannedR: 2 }), // exactly the stop: not past it
      at(4, -150, { rMultiple: -1.5, riskAmount: 100, grossPnl: -150 }), // 50 past
      at(5, -80, { rMultiple: -2, riskAmount: 40, grossPnl: -80 }), // 40 past
      at(6, 10),
    ]);
    assert.equal(r.withStop, 4);
    assert.equal(r.stopShare, 0.8);
    assert.equal(r.avgRisk, 85); // (100 + 100 + 100 + 40) / 4
    assert.equal(r.avgPlannedR, 2.5);
    assert.equal(r.avgActualR, -0.62); // (2 - 1 - 1.5 - 2) / 4 = -0.625, rounded toward zero at the half
    assert.deepEqual(r.beyondPlan, { count: 2, cost: 90 });
  });

  test("a loss at the stop isn't past it because of commission, and rounding doesn't count either", () => {
    const r = riskReport([
      at(2, -107, { rMultiple: -1.07, riskAmount: 100, grossPnl: -100 }), // 7 of commission
      at(3, -100.5, { rMultiple: -1.01, riskAmount: 100, grossPnl: -100.5 }), // half a percent of rounding
    ]);
    assert.deepEqual(r.beyondPlan, { count: 0, cost: 0 });
  });

  test("risk with no trades or no stops is blank, not NaN", () => {
    assert.deepEqual(riskReport([]), { withStop: 0, stopShare: null, avgRisk: null, avgPlannedR: null, avgActualR: null, beyondPlan: { count: 0, cost: 0 } });
    assert.equal(riskReport([at(2, 10)]).stopShare, 0);
  });

  test("comparing: A minus B, blank when either side is", () => {
    const a = computeMetrics([at(2, 100), at(3, -50)], UTC); // net 50, 50%, PF 2
    const b = computeMetrics([at(2, 30)], UTC); // net 30, 100%, no PF
    const rows = compareMetrics(a, b);
    const row = (k: string) => rows.find((r) => r.key === k)!;
    assert.deepEqual([row("netPnl").a, row("netPnl").b, row("netPnl").diff], [50, 30, 20]);
    assert.equal(row("winRate").diff, -0.5);
    assert.equal(row("closedTrades").diff, 1);
    assert.deepEqual([row("profitFactor").a, row("profitFactor").b, row("profitFactor").diff], [2, null, null]);
  });
});

describe("excursions and replay, by hand", () => {
  const bars = [{ high: 102, low: 99 }, { high: 105, low: 98 }, { high: 104, low: 100 }];

  test("a long's best is above entry, its worst below", () => {
    assert.deepEqual(excursions("long", 100, bars), { mae: 2, mfe: 5 });
  });

  test("a short's are the other way round", () => {
    assert.deepEqual(excursions("short", 100, bars), { mae: 5, mfe: 2 });
  });

  test("never below zero, when price never went that way", () => {
    assert.deepEqual(excursions("long", 90, bars), { mae: 0, mfe: 15 });
  });

  test("no bars, no reading", () => {
    assert.equal(excursions("long", 100, []), null);
  });

  test("stats in R, with left on the table from winners only", () => {
    const t = (pnl: number, over: Partial<Trade>) => closed("2026-03-02T10:00:00Z", pnl, { side: "long", entryPrice: 100, stopPrice: 98, ...over });
    const s = excursionStats([
      t(100, { exitPrice: 104, mae: 1, mfe: 6 }), // stop distance 2: MAE 0.5R, MFE 3R, exit 2R, 1R left behind
      t(-50, { exitPrice: 98, mae: 2, mfe: 1 }), // MAE 1R, MFE 0.5R, a loser: not in left behind
      t(10, { exitPrice: 101, mae: null, mfe: null }), // no reading
      t(10, { exitPrice: 101, stopPrice: null, mae: 1, mfe: 1 }), // no stop
    ]);
    assert.equal(s.sample, 2);
    assert.equal(s.avgMaeR, 0.75);
    assert.equal(s.avgMfeR, 1.75);
    assert.equal(s.leftBehindR, 1);
  });

  test("no readings, blanks", () => {
    assert.deepEqual(excursionStats([closed("2026-03-02T10:00:00Z", 5)]), { sample: 0, avgMaeR: null, avgMfeR: null, leftBehindR: null });
  });

  test("replay: a scaled position, step by step", () => {
    // Long 2 at 100, add 2 at 104 (average 102), out 2 at 106, out 2 at 101. 100 per point.
    const p = [{ side: "long" as const, perPoint: 100, fills: [
      { role: "entry" as const, price: 100, quantity: 2, at: 10 },
      { role: "entry" as const, price: 104, quantity: 2, at: 20 },
      { role: "exit" as const, price: 106, quantity: 2, at: 30 },
      { role: "exit" as const, price: 101, quantity: 2, at: 40 },
    ] }];
    assert.deepEqual(replayPnl(p, 5, 99), { realized: 0, open: 0, size: 0 }); // before anything
    assert.deepEqual(replayPnl(p, 15, 101), { realized: 0, open: 200, size: 2 }); // +1 x 2 x 100
    assert.deepEqual(replayPnl(p, 25, 103), { realized: 0, open: 400, size: 4 }); // (103 - 102) x 4 x 100
    assert.deepEqual(replayPnl(p, 35, 100), { realized: 800, open: -400, size: 2 }); // (106 - 102) x 2 x 100, then -2 x 2 x 100
    assert.deepEqual(replayPnl(p, 45, 50), { realized: 600, open: 0, size: 0 }); // 800 + (101 - 102) x 2 x 100, and flat ignores price
  });

  test("replay of a short, and two positions together", () => {
    const short = { side: "short" as const, perPoint: 1, fills: [{ role: "entry" as const, price: 50, quantity: 10, at: 1 }, { role: "exit" as const, price: 40, quantity: 10, at: 2 }] };
    const long = { side: "long" as const, perPoint: 1, fills: [{ role: "entry" as const, price: 10, quantity: 1, at: 1 }] };
    assert.deepEqual(replayPnl([short], 1, 45), { realized: 0, open: 50, size: -10 });
    assert.deepEqual(replayPnl([short, long], 2, 12), { realized: 100, open: 2, size: 1 });
  });

  test("the bar size follows the span", () => {
    assert.deepEqual([timeframeFor(3600), timeframeFor(8 * 3600), timeframeFor(8 * 3600 + 1), timeframeFor(4 * 86400), timeframeFor(20 * 86400)], ["M1", "M1", "M5", "M15", "H1"]);
  });
});

describe("simulated bars", () => {
  const anchors = [{ t: 1000, price: 100 }, { t: 1600, price: 104 }];

  test("every fill falls inside its bar, and it's repeatable", () => {
    const a = simulatedBars(anchors, 700, 1900, 60, 7);
    for (const f of anchors) {
      const bar = a.find((b) => b.t <= f.t && f.t < b.t + 60)!;
      assert.ok(bar.l <= f.price && f.price <= bar.h, `${f.price} in ${bar.l}-${bar.h}`);
    }
    assert.deepEqual(a, simulatedBars(anchors, 700, 1900, 60, 7));
    assert.notDeepEqual(a, simulatedBars(anchors, 700, 1900, 60, 8));
  });

  test("candles are well formed", () => {
    for (const b of simulatedBars(anchors, 700, 1900, 60, 3)) assert.ok(b.l <= b.o && b.l <= b.c && b.h >= b.o && b.h >= b.c && b.l > 0);
  });

  test("no fills, no bars", () => {
    assert.deepEqual(simulatedBars([], 0, 100, 60, 1), []);
  });
});
