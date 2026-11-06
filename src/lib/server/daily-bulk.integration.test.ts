import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-daily-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const D = await import("./repo/daily");
const { buildSampleDays, loadSampleData } = await import("./sample");
const { DailyInput, TradeInput } = await import("@/lib/domain/types");
const { guessMapping, mapRows, parseCsv, tradesCsv } = await import("@/lib/domain/csv");

let owner = 0;
let other = 0;
let main = 0;
let second = 0;

before(async () => {
  db();
  owner = ((await createUser("o@example.test", "correct horse battery", "O")) as { id: number }).id;
  other = ((await createUser("x@example.test", "correct horse battery", "X")) as { id: number }).id;
  main = J.createAccount(owner, { name: "Main", broker: "", currency: "USD", startingBalance: 0 }).id;
  second = J.createAccount(owner, { name: "Second", broker: "", currency: "USD", startingBalance: 0 }).id;
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const trade = (over: Record<string, unknown> = {}) =>
  TradeInput.parse({ accountId: main, symbol: "EURUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000, ...over });
const day = (over: Record<string, unknown>) => DailyInput.parse({ date: "2026-03-02", ...over });

describe("daily journal", () => {
  test("saves, reads back, and updates in place", () => {
    D.saveDay(owner, day({ plan: "first" }));
    D.saveDay(owner, day({ plan: "second", recap: "done", rating: 4 }));
    const e = D.getDay(owner, "2026-03-02", false);
    assert.deepEqual([e?.plan, e?.recap, e?.rating, e?.isSample], ["second", "done", 4, false]);
    assert.equal(D.listDays(owner, false).filter((x) => x.date === "2026-03-02").length, 1);
  });

  test("an entry emptied out goes away", () => {
    D.saveDay(owner, day({ date: "2026-03-03", plan: "x" }));
    assert.equal(D.saveDay(owner, day({ date: "2026-03-03", plan: "   " })), null);
    assert.equal(D.getDay(owner, "2026-03-03", false), null);
  });

  test("another user can't see it", () => {
    assert.equal(D.getDay(other, "2026-03-02", true), null);
    assert.equal(D.listDays(other, true).length, 0);
  });

  test("a date that doesn't exist is refused", () => {
    for (const date of ["2026-02-31", "2026-13-01", "03/02/2026", ""]) assert.equal(DailyInput.safeParse({ date }).success, false, date);
    assert.equal(DailyInput.safeParse({ date: "2028-02-29" }).success, true);
  });

  test("a rating outside 1 to 5 is refused", () => {
    assert.equal(DailyInput.safeParse({ date: "2026-03-02", rating: 6 }).success, false);
  });

  test("sample notes stay hidden, never replace the user's own, and go with the sample data, except days the user took over", () => {
    const days = buildSampleDays(new Date());
    assert.ok(days.length > 10);
    const mine = days[0].date;
    const edited = days[1].date;
    D.saveDay(owner, day({ date: mine, plan: "really mine" }));
    loadSampleData(owner);

    assert.equal(D.getDay(owner, mine, true)?.plan, "really mine");
    assert.equal(D.getDay(owner, edited, false), null);
    assert.equal(D.getDay(owner, edited, true)?.isSample, true);

    D.saveDay(owner, day({ date: edited, plan: "took it over" }));
    assert.equal(D.getDay(owner, edited, false)?.isSample, false);

    J.removeSampleData(owner);
    assert.deepEqual(D.listDays(owner, true).map((x) => x.isSample).filter(Boolean), []);
    assert.equal(D.getDay(owner, mine, false)?.plan, "really mine");
    assert.equal(D.getDay(owner, edited, false)?.plan, "took it over");
  });

  test("delete everything and the export both cover it", async () => {
    const u = ((await createUser("d@example.test", "correct horse battery", "D")) as { id: number }).id;
    D.saveDay(u, day({ plan: "x" }));
    assert.equal((J.exportAll(u).dailyJournal as unknown[]).length, 1);
    J.deleteAllData(u);
    assert.equal(D.listDays(u, true).length, 0);
  });
});

describe("bulk changes", () => {
  test("strategy set and cleared, across trades", () => {
    const [a, b] = [J.createTrade(owner, trade()), J.createTrade(owner, trade())];
    assert.deepEqual(J.bulkUpdateTrades(owner, [a.id, b.id], { type: "setStrategy", name: "Breakout" }), { changed: 2, skipped: [] });
    assert.equal(J.getTrade(owner, a.id)?.strategy, "Breakout");
    J.bulkUpdateTrades(owner, [a.id], { type: "clearStrategy" });
    assert.equal(J.getTrade(owner, a.id)?.strategy, "");
    assert.equal(J.getTrade(owner, b.id)?.strategy, "Breakout");
  });

  test("a tag adds once, leaves other tags alone, and removes", () => {
    const t = J.createTrade(owner, trade({ tags: ["keep"] }));
    J.bulkUpdateTrades(owner, [t.id], { type: "addTag", name: "new" });
    J.bulkUpdateTrades(owner, [t.id], { type: "addTag", name: "new" });
    assert.deepEqual(J.getTrade(owner, t.id)?.tags.sort(), ["keep", "new"]);
    J.bulkUpdateTrades(owner, [t.id], { type: "removeTag", name: "new" });
    assert.deepEqual(J.getTrade(owner, t.id)?.tags, ["keep"]);
  });

  test("the tag limit skips and says so", () => {
    const t = J.createTrade(owner, trade({ tags: Array.from({ length: 12 }, (_, i) => `t${i}`) }));
    const r = J.bulkUpdateTrades(owner, [t.id], { type: "addTag", name: "one more" });
    assert.equal(r.changed, 0);
    assert.match(r.skipped[0].reason, /12 tags/);
  });

  test("another user's trades aren't touched, and count as not found", () => {
    const t = J.createTrade(owner, trade({ notes: "mine" }));
    const r = J.bulkUpdateTrades(other, [t.id], { type: "setStrategy", name: "Theirs" });
    assert.deepEqual(r, { changed: 0, skipped: [{ reason: "not found", count: 1 }] });
    assert.equal(J.getTrade(owner, t.id)?.strategy, "");
  });

  test("moving carries the fills and keeps the result", () => {
    const t = J.createTrade(owner, trade({ commission: 2 }));
    assert.equal(J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: second }).changed, 1);
    const moved = J.getTrade(owner, t.id)!;
    assert.equal(moved.accountId, second);
    assert.equal(moved.pnl, t.pnl);
    assert.equal(moved.executions?.length, 2);
    const rows = db().prepare("SELECT DISTINCT account_id FROM executions WHERE trade_id = ?").all(t.id) as { account_id: number }[];
    assert.deepEqual(rows.map((r) => r.account_id), [second]);
  });

  test("moving refuses another user's account outright, changing nothing", () => {
    const theirs = J.createAccount(other, { name: "Theirs", broker: "", currency: "USD", startingBalance: 0 }).id;
    const t = J.createTrade(owner, trade());
    assert.throws(() => J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: theirs }));
    assert.equal(J.getTrade(owner, t.id)?.accountId, main);
  });

  test("moving skips other currencies, sample into real, and imported duplicates, and moves the rest", () => {
    const eur = J.createAccount(owner, { name: "Euro", broker: "", currency: "EUR", startingBalance: 0 }).id;
    const t = J.createTrade(owner, trade());
    assert.match(J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: eur }).skipped[0].reason, /another currency/);

    const sample = J.createAccount(owner, { name: "S", broker: "", currency: "USD", startingBalance: 0 }, { isSample: true }).id;
    assert.match(J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: sample }).skipped[0].reason, /sample and real/);
    assert.match(J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: main }).skipped[0].reason, /already in/);

    const first = J.createTrade(owner, trade(), { source: "csv", sourceKey: "same" });
    J.createTrade(owner, trade({ accountId: second }), { source: "csv", sourceKey: "same" });
    const okay = J.createTrade(owner, trade());
    const r = J.bulkUpdateTrades(owner, [first.id, okay.id], { type: "moveAccount", accountId: second });
    assert.equal(r.changed, 1);
    assert.match(r.skipped[0].reason, /already has this imported/);
    assert.equal(J.getTrade(owner, okay.id)?.accountId, second);
  });

  test("a synced trade takes notes-style changes but stays in its account", () => {
    const t = J.createTrade(owner, trade(), { source: "mt5", sourceKey: "pos:1" });
    assert.equal(J.bulkUpdateTrades(owner, [t.id], { type: "setStrategy", name: "Synced" }).changed, 1);
    const r = J.bulkUpdateTrades(owner, [t.id], { type: "moveAccount", accountId: second });
    assert.match(r.skipped[0].reason, /synced from MT5/);
    assert.equal(J.getTrade(owner, t.id)?.accountId, main);
  });
});

describe("csv export", () => {
  const exported = (t: ReturnType<typeof J.createTrade>) => parseCsv(tradesCsv([t], J.listAccounts(owner)));

  test("holds the figures, under one header per column", () => {
    const t = J.createTrade(owner, trade({ commission: 2, stopPrice: 1.09, tags: ["a", "b"] }));
    const [head, row] = exported(t);
    assert.equal(head.length, row.length);
    const cell = (name: string) => row[head.indexOf(name)];
    assert.equal(cell("Symbol"), "EURUSD");
    assert.equal(cell("Account"), "Main");
    assert.equal(cell("Net result"), "8"); // 0.01 x 1000 - 2
    assert.equal(cell("R multiple"), String(t.rMultiple));
    assert.equal(cell("Tags"), "a; b");
    assert.equal(cell("Open time"), "2026-02-02T09:00:00.000Z");
  });

  test("a note can't run as a spreadsheet formula, and commas and quotes survive", () => {
    const t = J.createTrade(owner, trade({ notes: '=HYPERLINK("x"), then more' }));
    const [head, row] = exported(t);
    assert.equal(row[head.indexOf("Notes")], `'=HYPERLINK("x"), then more`);
  });

  test("a loss stays a plain negative number", () => {
    const t = J.createTrade(owner, trade({ exitPrice: 1.09 }));
    const [head, row] = exported(t);
    assert.equal(row[head.indexOf("Net result")], "-10");
  });

  test("imports back to the same trade, costs with the right sign", () => {
    const t = J.createTrade(owner, trade({ commission: 3, swap: 1.5, stopPrice: 1.09, targetPrice: 1.13 }));
    const [head, ...rows] = exported(t);
    const mapping = guessMapping(head);
    const [back] = mapRows(rows, mapping, 2, {});
    assert.deepEqual(back.errors, []);
    const r = back.trade!;
    assert.deepEqual([r.symbol, r.side, r.entryPrice, r.exitPrice, r.quantity, r.stopPrice, r.targetPrice, r.commission], [t.symbol, t.side, t.entryPrice, t.exitPrice, t.quantity, t.stopPrice, t.targetPrice, t.commission]);
    assert.equal(new Date(r.openedAt).toISOString(), t.openedAt);
    assert.ok(r.swap === 0, "the cost column is not read as a credit");
  });
});
