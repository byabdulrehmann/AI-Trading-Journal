import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scoreAsset, scorePair, type CotWeek } from "./positioning";

const weeks = (nets: number[]): CotWeek[] =>
  nets.map((n, i) => ({ date: new Date(Date.UTC(2026, 0, 6 + 7 * i)).toISOString().slice(0, 10), long: 1000 + n, short: 1000, openInterest: 10000 }));

describe("positioning scorecard", () => {
  test("the COT index places this week's net within its range", () => {
    const a = scoreAsset("EUR", "Euro", weeks([-200, 0, 200, 100]))!;
    assert.equal(a.net, 100);
    assert.equal(a.cotIndex, 75);
    assert.equal(a.score, 0.5);
    assert.equal(a.weeklyChange, -100);
    assert.equal(a.netPct, 1);
    assert.equal(a.crowded, false);
  });

  test("a missing week leaves this week's change unknown rather than spanning two weeks", () => {
    const w = [
      { date: "2026-01-06", long: 1000, short: 1000, openInterest: 10000 },
      { date: "2026-01-20", long: 1100, short: 1000, openInterest: 10000 },
    ];
    assert.equal(scoreAsset("X", "X", w)!.weeklyChange, null);
    w[0].date = "2026-01-13";
    assert.equal(scoreAsset("X", "X", w)!.weeklyChange, 100);
  });

  test("a record high is crowded, a flat history is neutral, no history is nothing", () => {
    assert.equal(scoreAsset("X", "X", weeks([0, 50, 300]))!.crowded, true);
    assert.equal(scoreAsset("X", "X", weeks([40, 40]))!.cotIndex, 50);
    assert.equal(scoreAsset("X", "X", []), null);
  });

  test("a pair favours the currency speculators prefer", () => {
    const eur = scoreAsset("EUR", "Euro", weeks([0, 100]))!; // index 100
    const usd = scoreAsset("USD", "Dollar", weeks([100, 0]))!; // index 0
    assert.deepEqual(scorePair(eur, usd), { symbol: "EURUSD", base: "EUR", quote: "USD", cot: 1, macro: null, surprise: null, score: 1, bias: "bullish" });
    const both = scorePair(eur, usd, [-0.4, 0.4]);
    assert.deepEqual([both.cot, both.macro, both.score, both.bias], [1, -0.4, 0.3, "bullish"]);
    const all = scorePair(eur, usd, [-0.4, 0.4], [-1, 1]);
    assert.deepEqual([all.surprise, all.score, all.bias], [-1, -0.13, "neutral"]);
    assert.equal(scorePair(eur, usd, [null, 0.4], [null, null]).score, 1, "a missing side counts as no reading");
    assert.equal(scorePair(usd, eur).bias, "bearish");
    assert.equal(scorePair(eur, eur).bias, "neutral");
  });
});
