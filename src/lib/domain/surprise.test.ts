import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFigure, scoreSurprises, type SurpriseEvent } from "./surprise";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const ev = (e: Partial<SurpriseEvent>): SurpriseEvent => ({ at: "2026-11-10T13:30:00Z", currency: "USD", title: "Retail sales", impact: "high", actual: "", forecast: "", ...e });

describe("economic surprises", () => {
  test("figures as calendars write them", () => {
    assert.equal(parseFigure("2.5%"), 2.5);
    assert.equal(parseFigure("−0.1%"), -0.1);
    assert.equal(parseFigure("215K"), 215_000);
    assert.equal(parseFigure("1,234.5"), 1234.5);
    assert.equal(parseFigure("-3.2B"), -3.2e9);
    assert.equal(parseFigure("$-3.2B"), -3.2e9);
    assert.equal(parseFigure("-¥1.1T"), -1.1e12);
    assert.equal(parseFigure("<0.1%"), 0.1);
    assert.equal(parseFigure("£"), null);
    assert.equal(parseFigure(""), null);
    assert.equal(parseFigure("n/a"), null);
  });

  test("beats and misses weighted by impact, with unemployment flipped", () => {
    const [usd] = scoreSurprises(
      [
        ev({ actual: "0.6%", forecast: "0.3%" }), // high beat +3
        ev({ title: "Unemployment rate", impact: "medium", actual: "4.3%", forecast: "4.1%" }), // higher unemployment: miss −2
        ev({ title: "Jobless claims", impact: "low", actual: "210K", forecast: "225K" }), // fewer claims: beat +1
        ev({ title: "PMI", impact: "low", actual: "50", forecast: "50" }), // in line, weight 1
      ],
      ["USD"],
      NOW,
    );
    assert.equal(usd.score, Math.round((2 / 7) * 100) / 100);
    assert.deepEqual([usd.beats, usd.misses, usd.inline], [2, 1, 1]);
  });

  test("only the last 30 days, released already, with both figures, and not holidays", () => {
    const [usd, eur] = scoreSurprises(
      [
        ev({ at: "2026-09-01T13:30:00Z", actual: "1", forecast: "0" }),
        ev({ at: "2026-11-20T13:30:00Z", actual: "1", forecast: "0" }),
        ev({ actual: "1", forecast: "" }),
        ev({ impact: "holiday", actual: "1", forecast: "0" }),
        ev({ currency: "EUR", actual: "0", forecast: "1" }),
      ],
      ["USD", "EUR"],
      NOW,
    );
    assert.equal(usd.score, null);
    assert.equal(usd.releases.length, 0);
    assert.equal(eur.score, -1);
  });
});
