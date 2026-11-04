import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { guessMapping, mapRows, parseCsv, tradeKey, type ImportOptions } from "./csv";
import { computeMetrics, reportingCurrencies, tradesInCurrency } from "./metrics";
import { onlySent } from "./partial";
import { computePnl, computeR } from "./trade-math";
import { AccountUpdate, Settings, SettingsUpdate, TradeInput, type Account, type Trade, type TradeData } from "./types";

const OPEN = "2026-10-27 09:05";
const CLOSE = "2026-10-27 10:40";

/** Runs a CSV through the same steps as the import route; returns the result for its first row. */
function importRow(headers: string, row: string, options: ImportOptions = {}) {
  const [h, ...rows] = parseCsv(`${headers}\n${row}`);
  return mapRows(rows, guessMapping(h), 1, options)[0];
}

const BASE = "symbol,side,open time,close time,entry,exit,qty";

function trade(over: Partial<TradeData>): TradeData {
  return TradeInput.parse({ accountId: 1, symbol: "EURUSD", side: "long", openedAt: OPEN, closedAt: CLOSE, entryPrice: 100, exitPrice: 110, quantity: 2, ...over });
}

describe("profit", () => {
  test("long, short, fees and multiplier", () => {
    assert.equal(computePnl(trade({})), 20);
    assert.equal(computePnl(trade({ side: "short" })), -20);
    assert.equal(computePnl(trade({ fees: 3 })), 17);
    assert.equal(computePnl(trade({ multiplier: 100 })), 2000);
  });

  test("a negative fee is a credit", () => {
    assert.equal(computePnl(trade({ fees: -5 })), 25);
  });

  test("an open trade has no profit", () => {
    assert.equal(computePnl(trade({ exitPrice: null, closedAt: null })), null);
  });

  test("R is profit divided by planned risk", () => {
    assert.equal(computeR(trade({ stopPrice: 95 })), 2);
    assert.equal(computeR(trade({})), null);
  });
});

describe("CSV contract size", () => {
  const lots = "EURUSD,buy,2026-10-27 09:05,2026-10-27 10:40,1.0850,1.0900,1";

  test("defaults to 1, for files that give size in units", () => {
    assert.equal(importRow(BASE, lots).trade?.multiplier, 1);
  });

  test("one lot up 50 pips is 500 with a per-symbol contract size", () => {
    const { trade: t } = importRow(BASE, lots, { contractSizes: { EURUSD: 100000 } });
    assert.equal(computePnl(t!), 500);
  });

  test("a contract size column works and wins over the per-symbol size", () => {
    const { trade: t } = importRow(`${BASE},contract size`, `${lots},100000`, { contractSizes: { EURUSD: 7 } });
    assert.equal(t?.multiplier, 100000);
  });
});

describe("CSV numbers", () => {
  const price = (entry: string, exit: string, options?: ImportOptions) =>
    importRow(BASE, `EURUSD,buy,${OPEN},${CLOSE},"${entry}","${exit}",1`, options);

  test("a comma with no format chosen is rejected, never guessed", () => {
    assert.equal(price("1,0850", "1,0900").ok, false);
    assert.equal(price("1,085", "1,090").ok, false);
    assert.equal(price("1.234,56", "1.300,00").ok, false);
  });

  test("the comma format reads decimals and thousands", () => {
    assert.equal(price("1,0850", "1,0900", { numberFormat: "comma" }).trade?.entryPrice, 1.085);
    assert.equal(price("2.650,50", "2.660,00", { numberFormat: "comma" }).trade?.entryPrice, 2650.5);
  });

  test("the comma format rejects a dot that can't be thousands", () => {
    assert.equal(price("1.0850", "1.0900", { numberFormat: "comma" }).ok, false);
  });

  test("the dot format reads thousands and rejects misplaced commas", () => {
    assert.equal(price("2,650", "2,660", { numberFormat: "dot" }).trade?.entryPrice, 2650);
    assert.equal(price("1,0850", "1,0900", { numberFormat: "dot" }).ok, false);
  });

  test("plain numbers and commas proved by a dot need no choice", () => {
    assert.equal(price("1.085", "1.09").trade?.entryPrice, 1.085);
    assert.equal(price("2,650.50", "2,660.00").trade?.entryPrice, 2650.5);
  });
});

describe("CSV dates", () => {
  const opened = (value: string, options?: ImportOptions) => {
    const row = importRow("symbol,side,open time,entry,qty", `EURUSD,buy,${value},1.08,1`, options);
    return row.trade ? new Date(row.trade.openedAt) : row;
  };
  const monthDay = (d: unknown) => [(d as Date).getMonth() + 1, (d as Date).getDate()];

  test("03/10 with no format chosen is rejected, never guessed", () => {
    assert.equal((opened("03/10/2026 09:05") as { ok: boolean }).ok, false);
  });

  test("the chosen order decides day and month", () => {
    assert.deepEqual(monthDay(opened("03/10/2026 09:05", { dateOrder: "dmy" })), [10, 3]);
    assert.deepEqual(monthDay(opened("03/10/2026 09:05", { dateOrder: "mdy" })), [3, 10]);
  });

  test("a date that can only be read one way needs no choice", () => {
    assert.deepEqual(monthDay(opened("25/10/2026 09:05")), [10, 25]);
    assert.deepEqual(monthDay(opened("10/25/2026 09:05")), [10, 25]);
  });

  test("a date that doesn't exist is rejected", () => {
    assert.equal((opened("31/02/2026 09:05", { dateOrder: "dmy" }) as { ok: boolean }).ok, false);
  });

  test("a bare date means local midnight, not UTC midnight", () => {
    const d = opened("03/10/2026", { dateOrder: "dmy" }) as Date;
    assert.deepEqual(monthDay(d), [10, 3]);
    assert.equal(d.getHours(), 0);
  });

  test("the MT5 style still works", () => {
    assert.deepEqual(monthDay(opened("2026.10.03 14:05")), [10, 3]);
  });
});

describe("CSV fees and swap", () => {
  const fees = (commission: string, swap: string) =>
    importRow(`${BASE},commission,swap`, `EURUSD,buy,${OPEN},${CLOSE},1.08,1.09,1000,${commission},${swap}`).trade?.fees;

  test("commission counts as a cost whichever way the broker signs it", () => {
    assert.equal(fees("7", "0"), 7);
    assert.equal(fees("-7", "0"), 7);
  });

  test("swap keeps its sign: a credit lowers fees, a charge raises them", () => {
    assert.equal(fees("7", "12"), -5);
    assert.equal(fees("7", "-12"), 19);
  });
});

describe("CSV duplicates", () => {
  const a = trade({});

  test("the same trade gives the same key, even written differently", () => {
    assert.equal(tradeKey(a), tradeKey({ ...a, openedAt: new Date(a.openedAt).toISOString() }));
  });

  test("a different time, entry, size, side or symbol is a different trade", () => {
    for (const other of [{ openedAt: "2026-10-27 09:06" }, { entryPrice: 101 }, { quantity: 3 }, { side: "short" as const }, { symbol: "GBPUSD" }])
      assert.notEqual(tradeKey(a), tradeKey({ ...a, ...other }));
  });
});

describe("partial updates", () => {
  const update = (schema: typeof SettingsUpdate | typeof AccountUpdate, raw: unknown) => onlySent(schema.parse(raw), raw);

  test("changing one setting leaves out every other field", () => {
    assert.deepEqual(update(SettingsUpdate, { theme: "light" }), { theme: "light" });
  });

  test("changing one Jarvis setting can't reset sharing", () => {
    assert.deepEqual(update(SettingsUpdate, { jarvis: { memoryEnabled: false } }), { jarvis: { memoryEnabled: false } });
  });

  test("merged into stored settings, a change keeps the rest", () => {
    const stored = Settings.parse({ displayName: "R", activityTracking: true, dismissedPatterns: ["busy-days"], jarvis: { sharing: "metrics" } });
    const patch = update(SettingsUpdate, { jarvis: { memoryEnabled: false } }) as { jarvis: object };
    const next = Settings.parse({ ...stored, ...patch, jarvis: { ...stored.jarvis, ...patch.jarvis } });
    assert.equal(next.displayName, "R");
    assert.equal(next.activityTracking, true);
    assert.deepEqual(next.dismissedPatterns, ["busy-days"]);
    assert.equal(next.jarvis.sharing, "metrics");
    assert.equal(next.jarvis.memoryEnabled, false);
  });

  test("archiving an account leaves its details out of the update", () => {
    assert.deepEqual(update(AccountUpdate, { archived: true }), { archived: true });
  });

  test("bad values are still rejected", () => {
    assert.equal(SettingsUpdate.safeParse({ theme: "purple" }).success, false);
    assert.equal(AccountUpdate.safeParse({ currency: "EUROS" }).success, false);
  });
});

describe("reporting and currencies", () => {
  const account = (id: number, currency: string, archived = false) => ({ id, currency, archived }) as Account;
  const closed = (id: number, accountId: number, pnl: number, day: number) =>
    ({ id, accountId, pnl, openedAt: `2026-10-0${day}T09:00:00.000Z`, closedAt: `2026-10-0${day}T10:00:00.000Z`, rMultiple: null, followedPlan: null }) as Trade;

  test("only currencies that have trades are offered", () => {
    const { currencies, primary } = reportingCurrencies([account(1, "USD"), account(2, "EUR"), account(3, "GBP")], [closed(1, 1, 10, 1), closed(2, 2, 10, 1)]);
    assert.deepEqual(currencies, ["USD", "EUR"]);
    assert.equal(primary, "USD");
  });

  test("an active account's currency comes before an archived one's", () => {
    const { primary } = reportingCurrencies([account(1, "USD", true), account(2, "EUR")], [closed(1, 1, 10, 1), closed(2, 2, 10, 1)]);
    assert.equal(primary, "EUR");
  });

  test("totals in one currency leave the other out", () => {
    const accounts = [account(1, "USD"), account(2, "EUR")];
    const trades = [closed(1, 1, 30, 1), closed(2, 2, 100, 2)];
    assert.equal(computeMetrics(tradesInCurrency(trades, accounts, "USD")).netPnl, 30);
    assert.equal(computeMetrics(tradesInCurrency(trades, accounts, "EUR")).netPnl, 100);
  });

  test("win rate, profit factor and drawdown", () => {
    const m = computeMetrics([closed(1, 1, 100, 1), closed(2, 1, -40, 2), closed(3, 1, -20, 3), closed(4, 1, 60, 4)]);
    assert.equal(m.netPnl, 100);
    assert.equal(m.winRate, 0.5);
    assert.equal(m.profitFactor, 2.67);
    assert.equal(m.maxDrawdown, 60);
  });
});
