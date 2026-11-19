import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { seasonality, trend, type DailyClose } from "./seasonal";

/** A broker on GMT+2: each daily bar starts at 22:00 UTC the evening before. */
const bar = (y: number, m: number, d: number, c: number): DailyClose => ({ t: Date.UTC(y, m, d) / 1000 - 2 * 3600, c });

describe("seasonality", () => {
  test("the current month's record over past years, by each month's last close", () => {
    const closes: DailyClose[] = [];
    // November: up in 2019–2023 and 2025 (from 100 to 110), down in 2024 (to 90).
    for (let y = 2019; y <= 2025; y++) closes.push(bar(y, 9, 31, 100), bar(y, 10, 1, 105), bar(y, 10, 30, y === 2024 ? 90 : 110));
    closes.push(bar(2026, 9, 31, 100), bar(2026, 10, 2, 50)); // this year's November isn't finished: left out
    const s = seasonality(closes, new Date("2026-11-18T12:00:00Z"))!;
    assert.deepEqual([s.month, s.years, s.upYears], [10, 7, 6]);
    assert.equal(s.score, Math.round((5 / 7) * 100) / 100);
    assert.equal(s.avgPct, Math.round(((6 * 0.1 - 0.1) / 7) * 10000) / 100);
  });

  test("a bar stamped late the evening before still counts for its own day's month", () => {
    const closes = [];
    for (let y = 2020; y <= 2025; y++) closes.push(bar(y, 9, 31, 100), bar(y, 10, 1, 120)); // the Nov 1 bar is stamped 22:00 UTC on Oct 31
    assert.equal(seasonality(closes, new Date("2026-11-18T12:00:00Z"))!.upYears, 6);
  });

  test("fewer than five years: nothing to say", () => {
    const closes = [bar(2024, 9, 31, 100), bar(2024, 10, 29, 110), bar(2025, 9, 31, 100), bar(2025, 10, 28, 110)];
    assert.equal(seasonality(closes, new Date("2026-11-18T12:00:00Z")), null);
  });
});

describe("trend", () => {
  const rising = Array.from({ length: 220 }, (_, i) => ({ t: i * 86400, c: 100 + i }));

  test("above all three averages scores +1, below all three −1", () => {
    assert.deepEqual(trend(rising), { above: { "20": true, "50": true, "200": true }, score: 1 });
    assert.equal(trend(rising.map((b) => ({ ...b, c: 1000 - b.c }))).score, -1);
  });

  test("too little history leaves the longer averages out", () => {
    const t = trend(rising.slice(0, 60));
    assert.deepEqual(t.above, { "20": true, "50": true, "200": null });
    assert.equal(trend([]).score, null);
  });
});
