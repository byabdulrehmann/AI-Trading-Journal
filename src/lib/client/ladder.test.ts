import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { journalHref, periodRange } from "./journal-links";
import { decimalsOf, niceTicks, priceText, spreadLabels, tickOf } from "./ladder";

describe("price ladder helpers", () => {
  test("precision follows the text as typed", () => {
    assert.equal(decimalsOf("1.0810"), 4);
    assert.equal(decimalsOf("2650"), 0);
    assert.equal(decimalsOf(" "), null);
    assert.equal(decimalsOf("abc"), null);
    assert.equal(priceText(1.08104, 4), "1.0810");
    assert.equal(tickOf(2), 0.01);
  });
  test("ticks are round and inside the range", () => {
    assert.deepEqual(niceTicks(1.0795, 1.085, 4), [1.08, 1.081, 1.082, 1.083, 1.084, 1.085]);
    assert.deepEqual(niceTicks(5, 5, 4), []);
  });
  test("labels spread without overlapping and stay in bounds", () => {
    const out = spreadLabels([50, 52, 300], 18, 10, 200);
    assert.equal(out[1] - out[0] >= 18, true);
    assert.equal(out[2], 200);
    assert.deepEqual(spreadLabels([5, 6], 18, 10, 12), [-6, 12]);
  });
});

describe("journal links", () => {
  test("keep filters, drop this screen's own params", () => {
    assert.equal(journalHref("period=week&accountId=3&page=2", { symbol: "EURUSD" }), "/journal?accountId=3&closedOnly=1&symbol=EURUSD");
  });
  test("period keys become local close-date ranges", () => {
    assert.deepEqual(periodRange("month", "2026-02"), { closedFrom: "2026-02-01", closedTo: "2026-02-28" });
    assert.deepEqual(periodRange("week", "2026-12-28"), { closedFrom: "2026-12-28", closedTo: "2027-01-03" });
    assert.deepEqual(periodRange("day", "2026-11-05"), { closedFrom: "2026-11-05", closedTo: "2026-11-05" });
    assert.deepEqual(periodRange("year", "2026"), { closedFrom: "2026-01-01", closedTo: "2026-12-31" });
    assert.equal(periodRange("month", "nonsense"), null);
  });
});
