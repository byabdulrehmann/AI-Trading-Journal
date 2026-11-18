import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { quarterOnQuarter, scoreMacro, type MacroInput, type Observation } from "./macro";

const TODAY = Date.parse("2026-11-18");
const monthly = (values: number[], end = "2026-10"): Observation[] => {
  const [y, m] = end.split("-").map(Number);
  return values.map((value, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (values.length - 1 - i), 1));
    return { date: d.toISOString().slice(0, 10), value };
  });
};
const economy = (key: string, rates: number[], growth: number, unemployment: number[]): MacroInput => ({
  key,
  rate: monthly(rates),
  growth: [{ date: "2026-07-01", value: growth }],
  unemployment: monthly(unemployment),
});

describe("macro score", () => {
  test("higher rates, hikes, growth and falling unemployment score higher", () => {
    const [strong, middle, weak] = scoreMacro(
      [
        economy("AAA", [3, 3, 3, 3, 3, 3, 4], 1, [5, 5, 5, 5, 5, 5, 4]),
        economy("BBB", [2, 2, 2, 2, 2, 2, 2], 0.5, [5, 5, 5, 5, 5, 5, 5]),
        economy("CCC", [2, 2, 2, 2, 2, 2, 1], 0, [5, 5, 5, 5, 5, 5, 6]),
      ],
      TODAY,
    );
    assert.ok(strong.score! > middle.score! && middle.score! > weak.score!);
    assert.ok(strong.score! > 0 && weak.score! < 0);
    assert.deepEqual(strong.factors.map((f) => f.value), [4, 1, 1, -1]);
    assert.equal(weak.factors.find((f) => f.id === "jobs")!.value, 1);
  });

  test("an out-of-date series is left out, and a factor too few economies have isn't scored", () => {
    const stale = economy("OLD", [5, 5, 5, 5, 5, 5, 5], 3, [4]);
    stale.rate = monthly([5, 5, 5, 5, 5, 5, 5], "2025-01");
    const [old, a, b] = scoreMacro([stale, economy("AAA", [1, 1, 1, 1, 1, 1, 1], 1, [5]), economy("BBB", [2, 2, 2, 2, 2, 2, 2], 4, [5])], TODAY);
    assert.equal(old.factors[0].value, null);
    assert.equal(old.factors[0].score, null);
    assert.equal(a.factors[0].score, null, "only two economies have a fresh rate");
    assert.ok(b.factors.find((f) => f.id === "growth")!.score! > 0);
    assert.equal(a.factors.find((f) => f.id === "jobs")!.value, null, "one reading has no 6-month change");
  });

  test("no data means no score", () => {
    assert.equal(scoreMacro([{ key: "X", rate: [], growth: [], unemployment: [] }], TODAY)[0].score, null);
  });

  test("q/q growth from levels", () => {
    assert.deepEqual(quarterOnQuarter([{ date: "2026-01-01", value: 100 }, { date: "2026-04-01", value: 101 }]), [{ date: "2026-04-01", value: 1 }]);
  });
});
