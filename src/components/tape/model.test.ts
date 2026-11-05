import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brushRange, buildPoints, localDay, nearestIndex, tickColumns, xPositions } from "./model";

const curve = (...equity: number[]) => equity.map((e, i) => ({ tradeId: i + 1, at: new Date(Date.UTC(2026, 0, 10 + i, 12)).toISOString(), equity: e }));

describe("the Tape's model", () => {
  test("per-trade net is the step in equity, the first from zero", () => {
    const points = buildPoints(curve(10, 7.5, 7.5), [{ drawdown: 0 }, { drawdown: -2.5 }, { drawdown: -2.5 }]);
    assert.deepEqual(points.map((p) => p.net), [10, -2.5, 0]);
    assert.equal(points[1].drawdown, -2.5);
  });

  test("0, 1 and 2 trades place sensibly", () => {
    assert.deepEqual(xPositions([], 0, 100), []);
    assert.deepEqual(xPositions(buildPoints(curve(1), []), 0, 100), [50]);
    assert.deepEqual(xPositions(buildPoints(curve(1, 2), []), 0, 100), [0, 100]);
    assert.equal(nearestIndex([], 5), -1);
  });

  test("trades at one instant still spread out", () => {
    const same = curve(1, 2, 3).map((p) => ({ ...p, at: "2026-01-10T12:00:00.000Z" }));
    assert.deepEqual(xPositions(buildPoints(same, []), 0, 100), [0, 50, 100]);
  });

  test("nearest reads every trade, even thousands in few pixels", () => {
    const xs = Array.from({ length: 5000 }, (_, i) => i / 10);
    assert.equal(nearestIndex(xs, 123.4), 1234);
    assert.equal(nearestIndex([0, 10], 5), 0);
    assert.equal(nearestIndex([0, 10], 6), 1);
    assert.equal(nearestIndex([0, 10], 99), 1);
  });

  test("columns keep the extremes without touching the points", () => {
    const points = buildPoints(curve(5, 2, 9, 9), []);
    const columns = tickColumns(points, [0.1, 0.2, 0.3, 4], 2);
    assert.deepEqual(columns, [{ x: 0, win: 7, loss: 3, flat: false }, { x: 4, win: 0, loss: 0, flat: true }]);
    assert.equal(points.length, 4);
  });

  test("a brush names its trades and local days, and an empty one is nothing", () => {
    const points = buildPoints(curve(5, 2, 9), []);
    const xs = [0, 50, 100];
    const b = brushRange(points, xs, 100, 40)!;
    assert.deepEqual([b.first, b.last, b.count, b.net], [1, 2, 2, 4]);
    assert.equal(b.from, localDay(points[1].ms));
    assert.equal(b.to, localDay(points[2].ms));
    assert.equal(brushRange(points, xs, 60, 90), null);
  });
});
