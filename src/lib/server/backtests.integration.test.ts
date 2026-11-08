import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/** Real SQLite and the real session code. Only the MT5 client is swapped, so no terminal starts. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-backtest-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

type Fake = { bars: number[][]; requests: number };
const fakes = globalThis as unknown as { __btFake: Fake };
fakes.__btFake = { bars: [], requests: 0 };
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "./client" || spec.endsWith("/mt5/client")) {
      return { url: `data:text/javascript,${encodeURIComponent(`const f = globalThis.__btFake;
        export async function fetchBars(r) { f.requests++; return { ok: true, bars: f.bars.filter((b) => b[0] >= r.from && b[0] <= r.to) }; }
        export async function runSession() { return { ok: false, category: "other" }; }
        export async function stopService() {}`)}`, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const { db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const R = await import("./repo/mt5");
const { encrypt } = await import("./mt5/crypto");
const B = await import("./backtests");

const fake = fakes.__btFake;
const S = Date.parse("2026-03-02T10:00:00Z") / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString();
// Warm-up bars before the start close at 100. Then: a quiet bar, a bar up to 104.5, then a fall to 97.
const bar = (t: number, o: number, h: number, l: number, c: number) => [t, o, h, l, c, 1];
fake.bars = [
  ...Array.from({ length: 5 }, (_, i) => bar(S - 300 + i * 60, 100, 100.4, 99.6, 100)),
  bar(S, 100, 101, 99, 100.5),
  bar(S + 60, 100.5, 104.5, 100, 104),
  bar(S + 120, 104, 104, 97, 97.5),
  bar(S + 180, 97.5, 98, 96.5, 97),
];

let owner = 0;
let other = 0;
let live = 0;
const input = { name: "Gold practice", symbol: "XAUUSD", timeframe: "M1" as const, start: iso(S), end: iso(S + 180), startingBalance: 5000, strategy: "" };

before(async () => {
  db();
  owner = ((await createUser("bt@example.test", "correct horse battery", "B")) as { id: number }).id;
  other = ((await createUser("other@example.test", "correct horse battery", "O")) as { id: number }).id;
  live = J.createAccount(owner, { name: "Live", broker: "", currency: "USD", startingBalance: 0 }, { source: "mt5" }).id;
  R.saveConnection(live, "1234", "Demo-Server", encrypt("investor-pw"));
  J.saveBrokerInstrument(live, { symbol: "XAUUSD", assetClass: "metal", contractSize: 10, digits: 2, point: 0.01, tickSize: 0.01, tickValue: 0.1, pipSize: 0.1, baseCurrency: "XAU", quoteCurrency: "USD", profitCurrency: "USD" });
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

describe("backtest sessions", () => {
  test("without a connected MT5 account, it says so and nothing is made", async () => {
    const r = await B.createSession(other, input);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /none is connected/);
    assert.equal(B.listSessions(other, true).length, 0);
  });

  test("when MT5 refused the logins, it says that, not that nothing is connected", async () => {
    R.recordFailure(live, new Date().toISOString(), "refused", true);
    const r = await B.createSession(owner, input);
    assert.match((r as { reason: string }).reason, /refused the last logins/);
    assert.equal(B.listSessions(owner, true).length, 0);
    R.saveConnection(live, "1234", "Demo-Server", encrypt("investor-pw"));
  });

  test("a session opens on the warm-up, and the page never gets a bar past it", async () => {
    const r = await B.createSession(owner, input);
    assert.ok(r.ok);
    const view = (await B.sessionView(owner, r.session.id))!;
    assert.equal(view.session.cursor, iso(S - 60));
    assert.ok(view.bars.every((b) => b.t <= S - 60));
    assert.equal(view.bars.length, 5);
    assert.equal(J.getAccount(owner, r.session.accountId)?.source, "backtest");
    assert.equal(view.session.startingBalance, 5000);
  });

  test("a long fills at the bar's close, then its target closes it, with P&L worked out like any trade", async () => {
    const s = B.listSessions(owner, false)[0];
    assert.equal((await B.placeOrder(owner, s.id, { side: "long", quantity: 2, stopPrice: 100, targetPrice: 104, note: "" })).ok, false);
    const placed = await B.placeOrder(owner, s.id, { side: "long", quantity: 2, stopPrice: 98, targetPrice: 104, note: "Range break" });
    assert.ok(placed.ok);
    const opened = J.getTrade(owner, placed.tradeId!)!;
    assert.deepEqual([opened.entryPrice, opened.openedAt, opened.multiplier, opened.status, opened.source, opened.entryReason], [100, iso(S - 1), 10, "open", "backtest", "Range break"]);

    assert.ok((await B.stepSession(owner, s.id, 1)).ok); // the quiet bar: nothing happens
    assert.equal(J.getTrade(owner, placed.tradeId!)!.status, "open");
    assert.ok((await B.stepSession(owner, s.id, 1)).ok);
    const t = J.getTrade(owner, placed.tradeId!)!;
    // (104 - 100) x 2 x 10 = 80, with the stop 2 away: 20 x 2 = 40 at risk, so 2R. High 104.5, low 99 while open.
    assert.deepEqual([t.status, t.exitPrice, t.closedAt, t.pnl, t.rMultiple, t.exitReason, t.mfe, t.mae], ["closed", 104, iso(S + 60), 80, 2, "Target reached", 4.5, 1]);
  });

  test("a short closed by hand fills at the current close", async () => {
    const s = B.listSessions(owner, false)[0];
    const placed = await B.placeOrder(owner, s.id, { side: "short", quantity: 1, stopPrice: null, targetPrice: null, note: "" });
    await B.stepSession(owner, s.id, 1);
    assert.ok((await B.closePosition(owner, s.id, placed.tradeId!)).ok);
    const t = J.getTrade(owner, placed.tradeId!)!;
    // In at 104, out at 97.5: 6.5 x 1 x 10 = 65.
    assert.deepEqual([t.exitPrice, t.pnl, t.exitReason, t.closedAt], [97.5, 65, "Closed by hand", iso(S + 179)]);
    assert.equal((await B.closePosition(owner, s.id, placed.tradeId!)).ok, false);
  });

  test("at the last bar, no new trade can open, and stepping stays put", async () => {
    const s = B.listSessions(owner, false)[0];
    await B.stepSession(owner, s.id, 50);
    const view = (await B.sessionView(owner, s.id))!;
    assert.equal(view.atEnd, true);
    assert.equal(view.session.cursor, iso(S + 180));
    assert.match(((await B.placeOrder(owner, s.id, { side: "long", quantity: 1, stopPrice: null, targetPrice: null, note: "" })) as { reason: string }).reason, /reached its end/);
  });

  test("backtest trades stay out of live figures, and show when their session is asked for", () => {
    const s = B.listSessions(owner, false)[0];
    assert.equal(J.listTrades(owner).length, 0);
    assert.equal(J.listTrades(owner, { includeSample: true }).length, 0);
    assert.equal(J.listTrades(owner, { accountId: s.accountId }).length, 2);
    assert.equal(J.listTrades(owner, { source: "backtest" }).length, 2);
    assert.equal(s.netPnl, 145);
  });

  test("another user sees none of it and can't act on it", async () => {
    const s = B.listSessions(owner, false)[0];
    assert.equal(B.getSession(other, s.id), null);
    assert.equal((await B.stepSession(other, s.id, 1)).ok, false);
    assert.equal(B.deleteSession(other, s.id), null);
  });

  test("deleting a session removes its account and trades, and nothing else", () => {
    const s = B.listSessions(owner, false)[0];
    assert.deepEqual(B.deleteSession(owner, s.id), []);
    assert.equal(B.getSession(owner, s.id), null);
    assert.equal(J.listTrades(owner, { source: "backtest" }).length, 0);
    assert.ok(J.getAccount(owner, live));
  });
});

describe("the sample session", () => {
  test("its trades follow the engine's rules and go with the rest of the sample data", () => {
    const id = B.createSampleSession(owner, new Date("2026-03-20T00:00:00Z"));
    const s = B.getSession(owner, id)!;
    assert.deepEqual([s.isSample, s.source], [true, "simulated"]);
    assert.equal(B.listSessions(owner, false).some((x) => x.id === id), false);
    const trades = J.listTrades(owner, { accountId: s.accountId });
    assert.ok(trades.length >= 5);
    for (const t of trades) {
      assert.equal(t.status, "closed");
      assert.ok(t.exitPrice === t.stopPrice || t.exitPrice === t.targetPrice || (t.side === "long" ? t.exitPrice! < t.stopPrice! || t.exitPrice! > t.targetPrice! : t.exitPrice! > t.stopPrice! || t.exitPrice! < t.targetPrice!), `trade ${t.id} left at a level`);
    }
    J.removeSampleData(owner);
    assert.equal(B.getSession(owner, id), null);
  });
});
