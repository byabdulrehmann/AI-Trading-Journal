import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dayKey, dayWindow, weeksOf } from "./calendar";

process.env.TZ = "America/New_York"; // Has DST changes on 8 March and 1 November 2026.

describe("calendar days across DST", () => {
  for (const [year, month] of [[2026, 2], [2026, 10], [2026, 1], [2024, 1]]) {
    test(`${year}-${month + 1}: consecutive Monday-first days covering the month`, () => {
      const days = weeksOf(year, month).flat();
      assert.equal(days[0].getDay(), 1);
      assert.equal(days.length % 7, 0);
      const keys = days.map(dayKey);
      assert.equal(new Set(keys).size, keys.length);
      const count = new Date(year, month + 1, 0).getDate();
      assert.equal(days.filter((d) => d.getMonth() === month).length, count);
      for (let i = 1; i < days.length; i++) assert.equal(days[i].getDate() === 1 || days[i].getDate() === days[i - 1].getDate() + 1, true);
    });
  }

  test("a day window follows the clock, not 24 hours", () => {
    const spring = dayWindow("2026-03-08");
    assert.equal(spring.start, "2026-03-08T05:00:00.000Z");
    assert.equal(spring.end, "2026-03-09T03:59:59.999Z"); // 23 hours
    const autumn = dayWindow("2026-11-01");
    assert.equal(autumn.start, "2026-11-01T04:00:00.000Z");
    assert.equal(autumn.end, "2026-11-02T04:59:59.999Z"); // 25 hours
  });
});
