import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";

/** Real SQLite, real bar code. Only the service client is swapped, so no terminal ever starts here. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-bars-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

type Fake = { next: { ok: boolean; bars?: unknown[]; category?: string }; requests: Record<string, unknown>[] };
const fakes = globalThis as unknown as { __barsFake: Fake };
fakes.__barsFake = { next: { ok: true, bars: [] }, requests: [] };
const stub = (js: string) => ({ url: `data:text/javascript,${encodeURIComponent(js)}`, shortCircuit: true });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "./client" || spec.endsWith("/mt5/client")) {
      return stub(`const f = globalThis.__barsFake;
        export async function fetchBars(r) { f.requests.push(r); return f.next; }
        export async function runSession() { return { ok: false, category: "other" }; }
        export async function stopService() {}`);
    }
    return next(spec, ctx);
  },
});

const { db } = await import("../db");
const { createUser } = await import("../auth");
const J = await import("../repo/journal");
const R = await import("../repo/mt5");
const { encrypt } = await import("./crypto");
const { barsFor } = await import("./bars");
const { tradeBars } = await import("../tradeBars");
const { TradeInput } = await import("@/lib/domain/types");

let owner = 0;
let other = 0;
let account = 0;
const PASSWORD = "investor-Secret-9x7";
const NOW = 2_000_000_000;

const fake = fakes.__barsFake;
const withOffset = (seconds: number) => db().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`mt5:${account}`, JSON.stringify({ offsetSeconds: seconds, masterPasswordWarning: false }));

before(async () => {
  db();
  owner = ((await createUser("o@example.test", "correct horse battery", "O")) as { id: number }).id;
  other = ((await createUser("x@example.test", "correct horse battery", "X")) as { id: number }).id;
  account = J.createAccount(owner, { name: "Broker", broker: "", currency: "USD", startingBalance: 0 }, { source: "mt5" }).id;
  R.saveConnection(account, "1234", "Demo-Server", encrypt(PASSWORD));
});

beforeEach(() => {
  fake.next = { ok: true, bars: [] };
  fake.requests.length = 0;
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const raw = (t: number, c = 100) => [t, c, c + 1, c - 1, c + 0.5, 10];

describe("reading bars", () => {
  test("with no connection it says so and asks nothing", async () => {
    const r = await barsFor(other, "EURUSD", "M1", 1000, 2000, undefined, NOW);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /none is connected/);
    assert.equal(fake.requests.length, 0);
  });

  test("the broker's clock goes on the way out and comes off on the way in", async () => {
    withOffset(7200); // Broker two hours ahead of UTC.
    try {
      fake.next = { ok: true, bars: [raw(10_000 + 7200), raw(10_060 + 7200)] };
      const r = await barsFor(owner, "OFFSET", "M1", 9_000, 11_000, account, NOW);
      assert.ok(r.ok);
      const asked = fake.requests[0];
      assert.deepEqual([asked.from, asked.to, asked.symbol, asked.timeframe, asked.login, asked.server, asked.password], [9_000 + 7200, 11_000 + 7200, "OFFSET", "M1", 1234, "Demo-Server", PASSWORD]);
      assert.deepEqual(r.bars.map((x) => x.t), [10_000, 10_060]);
      assert.deepEqual([r.bars[0].o, r.bars[0].h, r.bars[0].l, r.bars[0].c], [100, 101, 99, 100.5]);
    } finally {
      withOffset(0);
    }
  });

  test("a range already fetched comes from storage, without asking again", async () => {
    fake.next = { ok: true, bars: [raw(20_000), raw(20_060)] };
    const first = await barsFor(owner, "CACHED", "M1", 19_000, 21_000, account, NOW);
    assert.equal(first.ok && first.bars.length, 2);
    assert.equal(fake.requests.length, 1);
    const second = await barsFor(owner, "CACHED", "M1", 19_500, 20_500, account, NOW);
    assert.equal(second.ok && second.bars.length, 2);
    assert.equal(fake.requests.length, 1);
  });

  test("a range reaching the present is asked again, since the last bar is still forming", async () => {
    fake.next = { ok: true, bars: [raw(NOW - 120)] };
    await barsFor(owner, "LIVE", "M1", NOW - 600, NOW, account, NOW);
    await barsFor(owner, "LIVE", "M1", NOW - 600, NOW, account, NOW);
    assert.equal(fake.requests.length, 2);
  });

  test("a symbol the broker doesn't list, or no history, is said plainly and nothing is made up", async () => {
    fake.next = { ok: false, category: "no_symbol" };
    const missing = await barsFor(owner, "NOPE", "M1", 1000, 2000, account, NOW);
    assert.match((missing as { reason: string }).reason, /doesn't list NOPE/);
    fake.next = { ok: true, bars: [] };
    const empty = await barsFor(owner, "EMPTY", "M1", 1000, 2000, account, NOW);
    assert.match((empty as { reason: string }).reason, /no price history/);
  });

  test("a failure says nothing the terminal said", async () => {
    fake.next = { ok: false, category: "other" };
    const r = await barsFor(owner, "FAIL", "M1", 1000, 2000, account, NOW);
    assert.equal((r as { reason: string }).reason, "Couldn't read prices from MT5 just now. Try again in a moment.");
  });

  test("a connection stopped by refusals, or disconnected, isn't asked", async () => {
    db().prepare("UPDATE mt5_connections SET status = 'auth_failed' WHERE account_id = ?").run(account);
    assert.equal((await barsFor(owner, "STOPPED", "M1", 1000, 2000, account, NOW)).ok, false);
    assert.equal(fake.requests.length, 0);
    db().prepare("UPDATE mt5_connections SET status = 'connected' WHERE account_id = ?").run(account);
  });

  test("another user's connection is never used", async () => {
    const mine = await barsFor(other, "CACHED", "M1", 19_500, 20_500, account, NOW);
    assert.equal(mine.ok, false);
  });
});

describe("a trade's bars", () => {
  const trade = (over: Record<string, unknown> = {}, origin = {}) =>
    J.createTrade(owner, TradeInput.parse({ accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 100, exitPrice: 101, quantity: 2, multiplier: 10, ...over }), origin);
  const at = (iso: string) => Date.parse(iso) / 1000;

  test("MAE and MFE come only from bars while the trade was open, and are saved", async () => {
    const t = trade({ symbol: "MAEMFE" });
    fake.next = { ok: true, bars: [
      [at("2026-02-02T08:50:00Z"), 100, 150, 50, 100, 1], // before the trade: its wild range must not count
      [at("2026-02-02T09:00:00Z"), 100, 103, 99, 101, 1],
      [at("2026-02-02T09:59:00Z"), 101, 104, 97, 101, 1],
      [at("2026-02-02T10:05:00Z"), 100, 170, 30, 100, 1], // after it
    ] };
    const r = await tradeBars(owner, J.getTrade(owner, t.id)!);
    assert.equal(r.source, "mt5");
    assert.equal(r.bars.length, 4);
    const saved = J.getTrade(owner, t.id)!;
    assert.deepEqual([saved.mae, saved.mfe], [3, 4]); // 100 - 97, 104 - 100
    assert.equal(r.markers.length, 2);
    assert.deepEqual(r.markers.map((m) => m.role), ["entry", "exit"]);
  });

  test("editing a trade's prices clears the reading, since it no longer holds", async () => {
    const t = trade({ symbol: "EDITED" });
    fake.next = { ok: true, bars: [[at("2026-02-02T09:30:00Z"), 100, 103, 99, 101, 1]] };
    await tradeBars(owner, J.getTrade(owner, t.id)!);
    assert.equal(J.getTrade(owner, t.id)?.mfe, 3);
    J.updateTrade(owner, t.id, TradeInput.parse({ accountId: account, symbol: "EDITED", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 90, exitPrice: 101, quantity: 2, multiplier: 10 }));
    assert.equal(J.getTrade(owner, t.id)?.mfe, null);
  });

  test("a real trade with no prices gets no bars and keeps no reading", async () => {
    const t = trade({ symbol: "NOPRICES" });
    fake.next = { ok: true, bars: [] };
    const r = await tradeBars(owner, J.getTrade(owner, t.id)!);
    assert.deepEqual([r.source, r.bars.length], [null, 0]);
    assert.ok(r.reason);
    assert.equal(J.getTrade(owner, t.id)?.mae, null);
  });

  test("only sample trades get made-up prices, marked as simulated, without asking MT5", async () => {
    const t = trade({ symbol: "SAMPLE" }, { source: "sample" });
    const r = await tradeBars(owner, J.getTrade(owner, t.id)!);
    assert.equal(r.source, "simulated");
    assert.ok(r.bars.length > 0);
    assert.equal(fake.requests.length, 0);
  });
});

describe("read-only guarantees", () => {
  const service = readFileSync(path.join(process.cwd(), "services/mt5/service.py"), "utf8");

  test("the bars request reads prices and nothing else", () => {
    for (const banned of ["order_send", "order_check", "positions_close", "Close("]) assert.ok(!service.includes(banned), banned);
    assert.ok(service.includes("mt5.copy_rates_range("));
    const handlers = service.match(/self\.path/g) ?? [];
    assert.ok(handlers.length >= 2);
  });

  test("the password goes no further than the service, and isn't in what's stored", () => {
    const rows = db().prepare("SELECT * FROM market_bars LIMIT 5").all();
    assert.ok(!JSON.stringify(rows).includes(PASSWORD));
    const bars = readFileSync(path.join(process.cwd(), "src/lib/server/mt5/bars.ts"), "utf8");
    assert.ok(!/console\./.test(bars));
  });
});
