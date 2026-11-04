import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { dec, toNumber, add } from "./decimal";
import { classifySymbol, normalizeSymbol, parsePair, pipSize, pipsBetween, resolveFxRate } from "./instruments";
import { computePosition } from "./position";
import { computeStats } from "./stats";

interface TradeCase {
  name: string;
  side: "long" | "short";
  contractSize: number;
  accountCurrency: string;
  symbol: string;
  fxRate: number | null;
  entries: { price: number; qty: number }[];
  exits: { price: number; qty: number }[];
  commission: number;
  swap: number;
  otherFees: number;
  stopPrice: number | null;
  expected: { grossPnl: number; netPnl: number; initialRisk: number | null; rMultiple: number | null; remainingQty: number; avgEntry: number; avgExit: number | null };
}

const vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8")) as {
  tradeCases: TradeCase[];
  statCases: { name: string; netPnls: number[]; expected: Record<string, number | null> }[];
};

const close = (actual: number | null, expected: number | null, label: string) => {
  if (expected === null) return assert.equal(actual, null, label);
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${label}: got ${actual}, hand-calculated ${expected}`);
};

describe("hand-calculated trade vectors", () => {
  for (const c of vectors.tradeCases) {
    test(c.name, () => {
      const r = computePosition({ ...c, profitCurrency: c.fxRate === null ? c.accountCurrency : undefined });
      // An open position has no realized P&L: the engine says null where the vectors, by their stated convention, say 0.
      const open = c.exits.length === 0;
      close(r.grossPnl ?? (open ? 0 : null), c.expected.grossPnl, "gross");
      if (!open) close(r.netPnl, c.expected.netPnl, "net");
      close(r.initialRisk, c.expected.initialRisk, "risk");
      if (!open) close(r.rMultiple, c.expected.rMultiple, "R");
      close(r.remainingQty, c.expected.remainingQty, "remaining");
      close(r.avgEntry, c.expected.avgEntry, "avg entry");
      close(r.avgExit, c.expected.avgExit, "avg exit");
    });
  }
});

describe("hand-calculated stat vectors", () => {
  for (const c of vectors.statCases) {
    test(c.name, () => {
      const s = computeStats(c.netPnls) as unknown as Record<string, number | null>;
      for (const [k, v] of Object.entries(c.expected)) close(s[k], v, k);
    });
  }
});

describe("decimal", () => {
  test("no binary float error", () => {
    assert.equal(toNumber(add(dec(0.1), dec(0.2)), 10), 0.3);
    assert.equal(toNumber(dec("1.005")), 1.01);
  });
  test("reads exponent notation", () => {
    assert.equal(toNumber(dec(1e-7), 7), 0.0000001);
    assert.equal(toNumber(dec(1.5e21 / 1e20)), 15);
  });
  test("refuses what isn't a number", () => {
    assert.throws(() => dec("abc"));
  });
});

describe("instrument conventions", () => {
  test("broker suffixes come off", () => {
    assert.equal(normalizeSymbol("EURUSDm"), "EURUSD");
    assert.equal(normalizeSymbol("XAUUSD.r"), "XAUUSD");
    assert.equal(normalizeSymbol("eurusd+"), "EURUSD");
  });
  test("classification", () => {
    assert.equal(classifySymbol("EURUSD"), "forex");
    assert.equal(classifySymbol("XAUUSD"), "metal");
    assert.equal(classifySymbol("US100"), "other");
    assert.equal(parsePair("ABCDEF"), null);
  });
  test("pip size: JPY differs, gold needs the broker's digits", () => {
    assert.equal(pipSize("EURUSD"), 0.0001);
    assert.equal(pipSize("USDJPY"), 0.01);
    assert.equal(pipSize("XAUUSD"), null);
    assert.ok(Math.abs((pipSize("XAUUSD", 2) as number) - 0.1) < 1e-12);
  });
  test("pips are signed by direction", () => {
    assert.equal(pipsBetween("EURUSD", "long", 1.085, 1.09), 50);
    assert.equal(pipsBetween("EURUSD", "short", 1.085, 1.09), -50);
  });
  test("fx: known, derived from the trade, or stated as missing", () => {
    assert.equal(resolveFxRate({ symbol: "EURUSD", accountCurrency: "USD" }), 1);
    assert.ok(Math.abs((resolveFxRate({ symbol: "USDJPY", accountCurrency: "USD", avgExit: 150 }) as number) - 1 / 150) < 1e-12);
    assert.equal(resolveFxRate({ symbol: "EURGBP", accountCurrency: "USD" }), null);
    assert.equal(resolveFxRate({ symbol: "EURGBP", accountCurrency: "USD", provided: 1.25 }), 1.25);
  });
});

describe("position edge cases", () => {
  const base = { side: "long" as const, symbol: "EURGBP", accountCurrency: "USD", contractSize: 100000, entries: [{ price: 0.85, qty: 1 }], exits: [{ price: 0.86, qty: 1 }] };
  test("a missing conversion rate is stated, never assumed to be 1", () => {
    const r = computePosition(base);
    assert.equal(r.pnlStatus, "needs_rate");
    assert.equal(r.netPnl, null);
  });
  test("exits beyond the entered size are flagged", () => {
    assert.equal(computePosition({ ...base, fxRate: 1, exits: [{ price: 0.86, qty: 2 }] }).pnlStatus, "over_closed");
  });
  test("the broker's profit is the gross, and implies the rate for risk", () => {
    const r = computePosition({ ...base, brokerProfit: 1250, stopPrice: 0.84, commission: 7 });
    assert.equal(r.grossPnl, 1250);
    assert.equal(r.netPnl, 1243);
    assert.equal(r.initialRisk, 1250);
    assert.equal(r.pnlStatus, "ok");
  });
  test("statuses", () => {
    assert.equal(computePosition({ ...base, fxRate: 1, exits: [] }).status, "open");
    assert.equal(computePosition({ ...base, fxRate: 1, exits: [{ price: 0.86, qty: 0.5 }] }).status, "partial");
    assert.equal(computePosition({ ...base, fxRate: 1 }).status, "closed");
  });
});
