import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { advance, orderProblem, resolveExit, type SimPosition } from "./backtest";
import type { Bar } from "./bars";

const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c });
// Long from 100, stop 98, target 104, filled at second 59 of the bar starting at 0.
const long: SimPosition = { side: "long", entry: 100, stop: 98, target: 104, openedAt: 59 };
const short: SimPosition = { side: "short", entry: 100, stop: 102, target: 96, openedAt: 59 };

describe("backtest exits", () => {
  test("the fill's own bar never counts, even if it spanned the stop", () => {
    assert.equal(resolveExit(long, [bar(0, 100, 105, 90, 100)], 1000), null);
  });

  test("a long reaches its target", () => {
    const bars = [bar(60, 100, 101, 99, 100.5), bar(120, 100.5, 104.2, 100, 104)];
    assert.deepEqual(resolveExit(long, bars, 1000), { t: 120, price: 104, reason: "target", bothInBar: false });
  });

  test("a long reaches its stop", () => {
    assert.deepEqual(resolveExit(long, [bar(60, 99.5, 99.8, 97.9, 98.5)], 1000), { t: 60, price: 98, reason: "stop", bothInBar: false });
  });

  test("both in one bar: the stop is taken, and it's flagged", () => {
    assert.deepEqual(resolveExit(long, [bar(60, 100, 104.5, 97.5, 101)], 1000), { t: 60, price: 98, reason: "stop", bothInBar: true });
  });

  test("a gap through the stop fills at the open, worse than the stop", () => {
    assert.deepEqual(resolveExit(long, [bar(60, 97, 97.5, 96, 96.5)], 1000), { t: 60, price: 97, reason: "stop", bothInBar: false });
  });

  test("a gap through the target fills at the open", () => {
    assert.deepEqual(resolveExit(long, [bar(60, 105, 106, 104.5, 105.5)], 1000), { t: 60, price: 105, reason: "target", bothInBar: false });
  });

  test("a short is the mirror: high reaches the stop, low the target", () => {
    assert.equal(resolveExit(short, [bar(60, 100, 102.1, 99, 100)], 1000)?.price, 102);
    assert.equal(resolveExit(short, [bar(60, 100, 101, 95.5, 96)], 1000)?.price, 96);
    assert.deepEqual(resolveExit(short, [bar(60, 103, 104, 102.5, 103)], 1000), { t: 60, price: 103, reason: "stop", bothInBar: false });
  });

  test("bars past the cursor aren't looked at: no peeking ahead", () => {
    const bars = [bar(60, 100, 101, 99, 100), bar(120, 100, 110, 99, 109)];
    assert.equal(resolveExit(long, bars, 60), null);
  });

  test("no stop and no target: only a manual close ends it", () => {
    assert.equal(resolveExit({ ...long, stop: null, target: null }, [bar(60, 100, 200, 1, 100)], 1000), null);
  });
});

describe("backtest orders", () => {
  test("levels must sit on the right side of the price", () => {
    assert.equal(orderProblem("long", 100, 98, 104), null);
    assert.match(orderProblem("long", 100, 100, 104)!, /stop must be below/);
    assert.match(orderProblem("long", 100, 98, 99)!, /target must be above/);
    assert.equal(orderProblem("short", 100, 102, 96), null);
    assert.match(orderProblem("short", 100, 99, 96)!, /stop must be above/);
    assert.equal(orderProblem("long", 100, null, null), null);
  });

  test("the cursor moves bar by bar and stops at the last bar", () => {
    const bars = [bar(0, 1, 1, 1, 1), bar(60, 1, 1, 1, 1), bar(180, 1, 1, 1, 1)];
    assert.equal(advance(bars, 0, 1), 60);
    assert.equal(advance(bars, 0, 2), 180); // a gap in the bars (a weekend) is just the next bar
    assert.equal(advance(bars, 0, 50), 180);
    assert.equal(advance(bars, 180, 1), 180);
  });
});
