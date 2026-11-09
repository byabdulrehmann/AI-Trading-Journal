import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ruleMatches, TagRuleInput, type TradeFacts } from "./autotag";
import { eventApplies, minutesToNews, parseEventsCsv } from "./econ";

const facts = (f: Partial<TradeFacts> = {}): TradeFacts => ({ symbol: "EURUSD", side: "long", session: "london", weekday: 1, hour: 9, closed: true, holdMinutes: 4, r: -1.5, pnl: -150, newsMinutes: null, ...f });

describe("economic calendar CSV", () => {
  test("a calendar export with am/pm times, read in New York time", () => {
    const csv = "Title,Country,Date,Time,Impact,Forecast,Previous\nNon-Farm Employment Change,USD,11-06-2026,8:30am,High,110K,95K\nBank Holiday,JPY,11-03-2026,All Day,Holiday,,\nCPI y/y,EUR,11-17-2026,5:00am,Medium,2.1%,2.0%\n";
    const r = parseEventsCsv(csv, { zone: "America/New_York" });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.events.map((e) => [e.at, e.allDay, e.currency, e.impact, e.forecast]), [
      ["2026-11-06T13:30:00.000Z", false, "USD", "high", "110K"], // EST is UTC-5 after Nov 1
      ["2026-11-03T05:00:00.000Z", true, "JPY", "holiday", ""],
      ["2026-11-17T10:00:00.000Z", false, "EUR", "medium", "2.1%"],
    ]);
  });

  test("ISO dates with the time in the same cell, day-first dates, and rows it can't read", () => {
    const r = parseEventsCsv("date,time,currency,event,impact\n2026-03-04 13:15,,USD,ADP,high\n31/03/2026,,GBP,GDP,low\n02/30/2026,,USD,Bad day,high\n2026-03-05,,USD,X,urgent\n", { zone: "UTC", dayFirst: true });
    assert.deepEqual(r.events.map((e) => [e.at, e.title]), [["2026-03-04T13:15:00.000Z", "ADP"], ["2026-03-31T00:00:00.000Z", "GDP"]]);
    assert.deepEqual(r.errors.map((e) => e.line), [4, 5]);
    assert.deepEqual(parseEventsCsv("when,what\n1,2").missing, ["date", "currency", "title", "impact"]);
  });

  test("an event counts for a symbol naming its currency, or for one naming none", () => {
    assert.equal(eventApplies("EURUSD", "USD"), true);
    assert.equal(eventApplies("EURUSD", "JPY"), false);
    assert.equal(eventApplies("AAPL", "JPY"), true);
    const events = [
      { at: "2026-03-04T13:30:00Z", allDay: false, impact: "high", currency: "USD" },
      { at: "2026-03-04T13:00:00Z", allDay: false, impact: "medium", currency: "USD" },
      { at: "2026-03-04T13:20:00Z", allDay: false, impact: "high", currency: "JPY" },
    ];
    assert.equal(minutesToNews("EURUSD", Date.parse("2026-03-04T13:10:00Z"), events), 20);
    assert.equal(minutesToNews("GBPJPY", Date.parse("2026-03-04T13:10:00Z"), events), 10);
    assert.equal(minutesToNews("EURGBP", Date.parse("2026-03-04T13:10:00Z"), events), null);
  });
});

describe("auto-tag rules", () => {
  test("every condition must match", () => {
    const rule = TagRuleInput.parse({ tag: "London scalp", conditions: [{ field: "session", op: "is", value: "london" }, { field: "hold", op: "under", value: "5" }] });
    assert.equal(ruleMatches(rule.conditions, facts()), true);
    assert.equal(ruleMatches(rule.conditions, facts({ holdMinutes: 5 })), false);
    assert.equal(ruleMatches(rule.conditions, facts({ session: "tokyo" })), false);
  });

  test("a rule about the result waits for the close; one that already fails doesn't wait", () => {
    const big = [{ field: "r" as const, op: "under", value: "-1" }, { field: "symbol" as const, op: "contains", value: "usd" }];
    assert.equal(ruleMatches(big, facts({ closed: false, r: null })), "later");
    assert.equal(ruleMatches(big, facts({ closed: false, r: null, symbol: "GBPJPY" })), false);
    // Closed without a stop: no R, so "under -1" can't be true.
    assert.equal(ruleMatches(big, facts({ r: null })), false);
    assert.equal(ruleMatches([{ field: "news", op: "within", value: "15" }], facts({ newsMinutes: 15 })), true);
    assert.equal(ruleMatches([{ field: "news", op: "within", value: "15" }], facts()), false);
    assert.equal(ruleMatches([{ field: "hour", op: "before", value: "9" }], facts()), false);
  });

  test("bad conditions are refused", () => {
    const bad = (c: object) => TagRuleInput.safeParse({ tag: "x", conditions: [c] }).success;
    assert.equal(bad({ field: "hour", op: "from", value: "24" }), false);
    assert.equal(bad({ field: "side", op: "is", value: "up" }), false);
    assert.equal(bad({ field: "r", op: "is", value: "1" }), false);
    assert.equal(bad({ field: "r", op: "over", value: "two" }), false);
    assert.equal(TagRuleInput.safeParse({ tag: "x", conditions: [] }).success, false);
  });
});
