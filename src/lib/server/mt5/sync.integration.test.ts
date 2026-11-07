import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import type { RawDeal } from "./normalize";
import type { SessionPayload, SessionResult } from "./client";

/**
 * Real SQLite in a temp folder, real route handlers, real sync code. Only two things are swapped:
 * the service client, so no terminal ever starts here, and the session cookie lookup.
 */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-mt5-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const fakes = globalThis as unknown as { __mt5Fake: { next: SessionResult; requests: { password: string; from: number }[]; stopped: number }; __cookie: string | undefined };
fakes.__mt5Fake = { next: { ok: false, category: "other" }, requests: [], stopped: 0 };

const stub = (js: string) => ({ url: `data:text/javascript,${encodeURIComponent(js)}`, shortCircuit: true });
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "./client" || spec.endsWith("/mt5/client")) {
      return stub(`const f = globalThis.__mt5Fake;
        export async function runSession(r) { f.requests.push(r); return f.next; }
        export async function stopService() { f.stopped++; }`);
    }
    if (spec === "next/headers") return stub(`export async function cookies() { return { get: () => ({ value: globalThis.__cookie }), set() {}, delete() {} }; }`);
    if (spec === "next/server") return stub(`export async function connection() {}`);
    return next(spec, ctx);
  },
});

const { db } = await import("../db");
const { createUser } = await import("../auth");
const { createHash } = await import("node:crypto");
const J = await import("../repo/journal");
const R = await import("../repo/mt5");
const { connectAccount, syncAccount, disconnectAccount, errorText } = await import("./sync");
const { nextDueMs } = await import("./scheduler");
const routes = {
  connect: await import("@/app/api/mt5/connect/route"),
  status: await import("@/app/api/mt5/status/route"),
  sync: await import("@/app/api/mt5/sync/route"),
  settings: await import("@/app/api/mt5/settings/route"),
  disconnect: await import("@/app/api/mt5/disconnect/route"),
  positions: await import("@/app/api/mt5/positions/route"),
};

const PASSWORD = "investor-Secret-9x7";
const T0 = 1_780_000_000;
let nextTicket = 5000;
let userId = 0;
let otherUserId = 0;

function deal(over: Partial<RawDeal>): RawDeal {
  const ticket = ++nextTicket;
  const time = over.time ?? T0 + ticket;
  return { ticket, order: ticket + 90000, time, time_msc: time * 1000, type: 0, entry: 0, position_id: 1, volume: 1, price: 1.1, commission: -2, swap: 0, profit: 0, fee: 0, symbol: "EURUSD", ...over };
}

function payload(over: Partial<SessionPayload> = {}, login = 777): SessionPayload {
  return {
    account: { login, currency: "USD", company: "Test Broker", balance: 1000, equity: 1010, margin: 50, margin_free: 960, margin_level: 2020, profit: 10, leverage: 100, margin_mode: 2, trade_allowed: false },
    positions: [],
    orders: [],
    deals: [],
    history_orders: [],
    symbols: { EURUSD: { name: "EURUSD", trade_contract_size: 100000, digits: 5, point: 0.00001, trade_tick_size: 0.00001, trade_tick_value: 1, currency_base: "EUR", currency_profit: "USD" } },
    // A live quote at a +2h broker clock.
    quote_time: T0 + 7200,
    utc_now: T0,
    ...over,
  };
}

const session = (over: Partial<SessionPayload> = {}, login = 777): SessionResult => ({ ok: true, payload: payload(over, login) });
const counts = (accountId: number) => ({ ...(db().prepare("SELECT (SELECT COUNT(*) FROM trades WHERE account_id = ?) AS trades, (SELECT COUNT(*) FROM executions WHERE account_id = ?) AS executions, (SELECT COUNT(*) FROM orders WHERE account_id = ?) AS orders").get(accountId, accountId, accountId) as { trades: number; executions: number; orders: number }) });
const tradesOf = (accountId: number, user = userId) => J.listTrades(user, { accountId });

async function connected(login: number, result = session({}, login)) {
  fakes.__mt5Fake.next = result;
  const r = await connectAccount(userId, login, "Test-Server", PASSWORD);
  assert.ok(r.ok);
  return r.accountId;
}

async function signIn(id: number) {
  const token = randomBytes(16).toString("hex");
  db().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(createHash("sha256").update(token).digest("hex"), id, "2026-01-01", "2999-01-01");
  fakes.__cookie = token;
}

before(async () => {
  db();
  userId = ((await createUser("owner@example.test", "correct horse battery", "Owner")) as { id: number }).id;
  otherUserId = ((await createUser("other@example.test", "another long password", "")) as { id: number }).id;
});

beforeEach(() => {
  fakes.__mt5Fake.requests = [];
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

describe("connecting", () => {
  test("a refused login stores nothing", async () => {
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    const r = await connectAccount(userId, 111, "Test-Server", PASSWORD);
    assert.equal(r.ok, false);
    assert.equal(R.findAccountId(userId, "111", "Test-Server"), null);
  });

  test("creates an mt5 account in the broker's currency, with the password encrypted", async () => {
    const id = await connected(1001, session({ account: { ...payload().account, login: 1001, currency: "EUR" } }, 1001));
    const account = J.getAccount(userId, id);
    assert.equal(account?.source, "mt5");
    assert.equal(account?.currency, "EUR");
    const { password_cipher } = R.readForSync(id)!;
    assert.ok(password_cipher && !password_cipher.includes(PASSWORD));
  });

  test("the same login and server don't make a second account, even after a disconnect", async () => {
    const id = await connected(1002);
    assert.equal(await connected(1002), id);
    await disconnectAccount(userId, id);
    assert.equal(await connected(1002), id);
    assert.equal(J.listAccounts(userId).filter((a) => a.name.endsWith("1002")).length, 1);
  });

  test("the first sync fetches full history, and later ones only from the mark minus an overlap", async () => {
    const id = await connected(1003);
    assert.equal(fakes.__mt5Fake.requests[0].from, 946684800);
    fakes.__mt5Fake.next = session({}, 1003);
    await syncAccount(id);
    const mark = Date.parse(R.readForSync(id)!.history_synced_to!) / 1000;
    assert.ok(fakes.__mt5Fake.requests[1].from < mark);
    assert.ok(fakes.__mt5Fake.requests[1].from > 946684800);
  });
});

describe("idempotent sync", () => {
  test("the same payload twice makes no duplicates", async () => {
    const deals = [deal({ position_id: 50 }), deal({ position_id: 50, type: 1, entry: 1, price: 1.11, profit: 1000 })];
    const history_orders = [{ ticket: deals[0].order, position_id: 50, sl: 1.09, tp: 1.13, symbol: "EURUSD", type: 0, state: 4, volume_initial: 1, volume_current: 0, price_open: 1.1, time_setup: T0, time_done: T0 }];
    const id = await connected(2001, session({ deals, history_orders }, 2001));
    const before = counts(id);
    assert.deepEqual(before, { trades: 1, executions: 2, orders: 1 });
    fakes.__mt5Fake.next = session({ deals, history_orders }, 2001);
    assert.ok((await syncAccount(id)).ok);
    assert.deepEqual(counts(id), before);
  });

  test("results go through the engine, with costs as costs and the broker's specs", async () => {
    const deals = [deal({ position_id: 51, commission: -3 }), deal({ position_id: 51, type: 1, entry: 1, price: 1.11, profit: 1000, commission: -3, swap: -1.5 })];
    const history_orders = [{ ticket: deals[0].order, position_id: 51, sl: 1.09, tp: 0, symbol: "EURUSD", type: 0, state: 4, volume_initial: 1, volume_current: 0, price_open: 1.1, time_setup: T0, time_done: T0 }];
    const id = await connected(2002, session({ deals, history_orders }, 2002));
    const [t] = tradesOf(id);
    assert.equal(t.source, "mt5");
    assert.equal(t.brokerPositionId, "51");
    assert.equal(t.multiplier, 100000);
    assert.equal(t.commission, 6);
    assert.equal(t.swap, 1.5);
    assert.equal(t.grossPnl, 1000);
    assert.equal(t.pnl, 992.5);
    assert.equal(t.stopPrice, 1.09);
    assert.equal(t.riskAmount, 1000);
    assert.equal(t.rMultiple, 0.99);
    assert.equal(t.status, "closed");
    assert.equal(J.listInstruments(userId, id)[0].source, "mt5");
  });

  test("stale quotes with markets shut never move stored times, and a confirmed change re-reads the history", async () => {
    const id = await connected(2099, session({ deals: [deal({ position_id: 154, time: T0 + 7200 })] }, 2099));
    const stored = () => (db().prepare("SELECT executed_at FROM executions WHERE account_id = ?").get(id) as { executed_at: string }).executed_at;
    const first = stored();
    // A Saturday: the newest quote is hours old, and stays the same each sync.
    for (let i = 0; i < 5; i++) {
      fakes.__mt5Fake.next = session({ deals: [deal({ position_id: 154, time: T0 + 7200 })], quote_time: T0 - 32400, utc_now: T0 }, 2099);
      assert.equal((await syncAccount(id)).ok, true);
    }
    assert.equal(stored(), first);
    assert.ok(R.readForSync(id)?.history_synced_to);

    // The broker really moved to +3h: three syncs with quotes moving on.
    for (let i = 0; i < 3; i++) {
      fakes.__mt5Fake.next = session({ deals: [deal({ position_id: 154, time: T0 + 7200 })], quote_time: T0 + 10800 + i * 60, utc_now: T0 + i * 60 }, 2099);
      await syncAccount(id);
    }
    assert.equal(R.readForSync(id)?.history_synced_to, null);
    assert.equal(stored(), new Date((T0 + 7200 - 10800) * 1000 + Date.parse(first) % 1000).toISOString());
  });

  test("broker clock offset is taken off the stored times", async () => {
    const id = await connected(2003, session({ deals: [deal({ position_id: 52, time: T0 + 7200 })] }, 2003));
    assert.equal(tradesOf(id)[0].openedAt, new Date(T0 * 1000).toISOString());
  });

  test("user notes and a user's stop survive a re-sync", async () => {
    const open = deal({ position_id: 53 });
    const id = await connected(2004, session({ deals: [open] }, 2004));
    const t = tradesOf(id)[0];
    J.updateTrade(userId, t.id, { ...t, notes: "my note", lessons: "a lesson", setup: "Breakout", stopPrice: 1.05, grade: "A", mistakes: ["late_exit"], tags: ["keep"], executions: null });

    const close = deal({ position_id: 53, type: 1, entry: 1, price: 1.12, profit: 2000 });
    fakes.__mt5Fake.next = session({ deals: [open, close] }, 2004);
    assert.ok((await syncAccount(id)).ok);
    const after = J.getTrade(userId, t.id)!;
    assert.equal(after.notes, "my note");
    assert.equal(after.lessons, "a lesson");
    assert.equal(after.setup, "Breakout");
    assert.equal(after.grade, "A");
    assert.deepEqual(after.tags, ["keep"]);
    assert.deepEqual(after.mistakes, ["late_exit"]);
    assert.equal(after.stopPrice, 1.05);
    assert.equal(after.pnl, 1996);
  });

  test("a new deal updates the same trade, even when its opening deal is outside the new window", async () => {
    const open = deal({ position_id: 54, volume: 2 });
    const id = await connected(2005, session({ deals: [open] }, 2005));
    const [{ id: tradeId }] = tradesOf(id);
    assert.equal(tradesOf(id)[0].status, "open");

    fakes.__mt5Fake.next = session({ deals: [deal({ position_id: 54, type: 1, entry: 1, volume: 0.5, price: 1.11, profit: 500 })] }, 2005);
    assert.ok((await syncAccount(id)).ok);
    let [t] = tradesOf(id);
    assert.equal(t.id, tradeId);
    assert.equal(t.status, "partial");
    assert.equal(t.remainingQty, 1.5);

    fakes.__mt5Fake.next = session({ deals: [deal({ position_id: 54, type: 1, entry: 1, volume: 1.5, price: 1.12, profit: 3000 })] }, 2005);
    assert.ok((await syncAccount(id)).ok);
    [t] = tradesOf(id);
    assert.equal(t.id, tradeId);
    assert.equal(t.status, "closed");
    assert.equal(t.grossPnl, 3500);
    assert.equal(tradesOf(id).length, 1);
    assert.equal(counts(id).executions, 3);
  });

  test("a netting reversal makes two trades and survives a re-sync", async () => {
    const deals = [deal({ position_id: 55, volume: 1 }), deal({ position_id: 55, type: 1, entry: 2, volume: 1.5, price: 1.2, profit: 10000, commission: -6 })];
    const id = await connected(2006, session({ deals }, 2006));
    assert.deepEqual(counts(id), { trades: 2, executions: 3, orders: 0 });
    fakes.__mt5Fake.next = session({ deals }, 2006);
    await syncAccount(id);
    assert.deepEqual(counts(id), { trades: 2, executions: 3, orders: 0 });
    const [newer, older] = tradesOf(id).sort((a, b) => b.id - a.id);
    assert.deepEqual([older.side, older.status], ["long", "closed"]);
    assert.deepEqual([newer.side, newer.status, newer.quantity], ["short", "open", 0.5]);
  });

  test("a soft-deleted trade stays deleted", async () => {
    const open = deal({ position_id: 56 });
    const id = await connected(2007, session({ deals: [open] }, 2007));
    J.setTradesDeleted(userId, [tradesOf(id)[0].id], true);
    fakes.__mt5Fake.next = session({ deals: [open] }, 2007);
    await syncAccount(id);
    assert.equal(tradesOf(id).length, 0);
  });

  test("a cut-off position is skipped and reported, and no trade is invented", async () => {
    const id = await connected(2008, session({ deals: [deal({ position_id: 57, type: 1, entry: 1, profit: 9 })] }, 2008));
    assert.equal(counts(id).trades, 0);
    assert.match(R.getConnection(userId, id)!.syncNote!, /incomplete: #57/);
  });

  test("a symbol with no spec gets no made-up risk", async () => {
    const deals = [deal({ position_id: 58, symbol: "NOSPEC" })];
    const history_orders = [{ ticket: deals[0].order, position_id: 58, sl: 1.0, tp: 0, symbol: "NOSPEC", type: 0, state: 4, volume_initial: 1, volume_current: 0, price_open: 1.1, time_setup: T0, time_done: T0 }];
    const id = await connected(2009, session({ deals, history_orders }, 2009));
    const [t] = tradesOf(id);
    assert.equal(t.stopPrice, null);
    assert.equal(t.riskAmount, null);
    assert.match(R.getConnection(userId, id)!.syncNote!, /No contract size/);
  });

  test("open positions are replaced on each sync", async () => {
    const pos = (identifier: number) => ({ identifier, symbol: "EURUSD", type: 1, volume: 1, price_open: 1.1, price_current: 1.09, sl: 0, tp: 0, swap: -1, profit: 100, time: T0, time_msc: T0 * 1000 });
    const id = await connected(2010, session({ positions: [pos(1), pos(2)] }, 2010));
    assert.equal(R.listOpenPositions(id).length, 2);
    fakes.__mt5Fake.next = session({ positions: [pos(3)] }, 2010);
    await syncAccount(id);
    const rows = R.listOpenPositions(id) as { broker_position_id: string; side: string; stop_loss: number | null }[];
    assert.deepEqual(rows.map((r) => [r.broker_position_id, r.side, r.stop_loss]), [["3", "short", null]]);
  });
});

describe("failures, staleness, disconnect", () => {
  test("a failed sync keeps the old data, records the error and makes it stale", async () => {
    const id = await connected(3001);
    assert.equal(R.getConnection(userId, id)!.stale, false);
    fakes.__mt5Fake.next = { ok: false, category: "no_connection", code: -10005 };
    const r = await syncAccount(id);
    assert.equal(r.ok, false);
    const c = R.getConnection(userId, id)!;
    assert.equal(c.state, "error");
    assert.equal(c.stale, true);
    assert.equal(c.balance, 1000);
    assert.ok(c.lastError);
    const job = db().prepare("SELECT status FROM sync_jobs WHERE account_id = ? ORDER BY id DESC LIMIT 1").get(id) as { status: string };
    assert.equal(job.status, "failed");
  });

  test("three refusals in a row stop automatic sync, so a wrong password can't lock the account", async () => {
    const id = await connected(3002);
    assert.ok(R.listSchedulable().some((s) => s.account_id === id));
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    await syncAccount(id);
    await syncAccount(id);
    assert.ok(R.listSchedulable().some((s) => s.account_id === id), "still retrying after two");
    assert.equal(R.getConnection(userId, id)!.state, "error");
    await syncAccount(id);
    assert.ok(!R.listSchedulable().some((s) => s.account_id === id));
    assert.equal(R.getConnection(userId, id)!.state, "auth_failed");
  });

  test("one refusal is a blip: it retries, a success clears it, and the count starts again", async () => {
    const id = await connected(3003);
    const good = session({}, 3003);
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    const first = await syncAccount(id);
    assert.equal(first.ok, false);
    assert.match((first as { error: string }).error, /short broker outage/);
    assert.ok(R.listSchedulable().some((s) => s.account_id === id));
    await syncAccount(id);
    fakes.__mt5Fake.next = good;
    assert.equal((await syncAccount(id)).ok, true);
    assert.equal(R.getConnection(userId, id)!.state, "connected");
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    await syncAccount(id);
    await syncAccount(id);
    assert.ok(R.listSchedulable().some((s) => s.account_id === id), "the earlier two no longer count");
  });

  test("another kind of failure in between resets the count", async () => {
    const id = await connected(3004);
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    await syncAccount(id);
    await syncAccount(id);
    fakes.__mt5Fake.next = { ok: false, category: "timeout" };
    await syncAccount(id);
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    await syncAccount(id);
    assert.ok(R.listSchedulable().some((s) => s.account_id === id));
  });

  test("stale rule: over twice the interval, or a failed last attempt", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const t = Date.parse(at);
    assert.equal(R.isStale(at, at, null, 60, t + 120_000), false);
    assert.equal(R.isStale(at, at, null, 60, t + 120_001), true);
    assert.equal(R.isStale(null, null, null, 60, t), true);
    assert.equal(R.isStale(at, "2026-01-01T00:00:30.000Z", "failed", 60, t + 31_000), true);
  });

  test("backoff doubles with failures and is capped", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const t = Date.parse(at);
    assert.equal(nextDueMs(null, 60, 0), 0);
    assert.equal(nextDueMs(at, 60, 0), t + 60_000);
    assert.equal(nextDueMs(at, 60, 2), t + 240_000);
    assert.equal(nextDueMs(at, 60, 30), t + 3_600_000);
  });

  test("a master password is flagged when the account allows trading", async () => {
    const id = await connected(3003, session({ account: { ...payload().account, login: 3003, trade_allowed: true } }, 3003));
    assert.equal(R.getConnection(userId, id)!.masterPasswordWarning, true);
  });

  test("disconnect removes the secret and open positions, and keeps the trades and account", async () => {
    const pos = { identifier: 9, symbol: "EURUSD", type: 0, volume: 1, price_open: 1.1, price_current: 1.1, sl: 0, tp: 0, swap: 0, profit: 0, time: T0, time_msc: 0 };
    const id = await connected(3004, session({ deals: [deal({ position_id: 60 })], positions: [pos] }, 3004));
    const stopped = fakes.__mt5Fake.stopped;
    await disconnectAccount(userId, id);
    assert.equal(R.readForSync(id)!.password_cipher, null);
    assert.equal(R.listOpenPositions(id).length, 0);
    assert.equal(R.getConnection(userId, id)!.state, "disconnected");
    assert.equal(tradesOf(id).length, 1);
    assert.ok(J.getAccount(userId, id));
    assert.equal(fakes.__mt5Fake.stopped, stopped + 1);
    assert.ok(!R.listSchedulable().some((s) => s.account_id === id));
    const r = await syncAccount(id);
    assert.equal(r.ok, false);
  });

  test("no error wording can carry anything the terminal said", () => {
    for (const c of ["wrong_password", "invalid_server", "terminal_missing", "no_connection", "timeout", "other"] as const) assert.ok(!errorText(c, -1).includes(PASSWORD));
  });
});

describe("routes", () => {
  const post = (body: unknown, method = "POST") => new Request("http://127.0.0.1/api/mt5/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const accountOf = (login: string) => R.findAccountId(userId, login, "Test-Server")!;

  test("every route refuses without a session", async () => {
    fakes.__cookie = undefined;
    const responses = await Promise.all([
      routes.connect.POST(post({})),
      routes.status.GET(),
      routes.sync.POST(post({})),
      routes.settings.PATCH(post({}, "PATCH")),
      routes.disconnect.POST(post({})),
      routes.positions.GET(new Request("http://127.0.0.1/api/mt5/positions?accountId=1")),
    ]);
    assert.deepEqual(responses.map((r) => r.status), [401, 401, 401, 401, 401, 401]);
  });

  test("the secret is in no response, on success or failure", async () => {
    await signIn(userId);
    const texts: string[] = [];
    const read = async (r: Response) => {
      const text = await r.text();
      texts.push(text);
      return JSON.parse(text);
    };
    fakes.__mt5Fake.next = session({ deals: [deal({ position_id: 70 })] }, 4001);
    const created = await read(await routes.connect.POST(post({ login: "4001", server: "Test-Server", password: PASSWORD })));
    const id = created.connection.accountId;
    fakes.__mt5Fake.next = session({}, 4001);
    await read(await routes.sync.POST(post({ accountId: id })));
    await read(await routes.status.GET());
    await read(await routes.settings.PATCH(post({ accountId: id, intervalSeconds: 120, enabled: true }, "PATCH")));
    await read(await routes.positions.GET(new Request(`http://127.0.0.1/api/mt5/positions?accountId=${id}`)));
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    await read(await routes.sync.POST(post({ accountId: id })));
    await read(await routes.connect.POST(post({ login: "4002", server: "Test-Server", password: PASSWORD })));
    await read(await routes.connect.POST(post({ login: "not digits", server: "Test-Server", password: PASSWORD })));
    await read(await routes.disconnect.POST(post({ accountId: id })));

    const cipher = (db().prepare("SELECT password_cipher FROM mt5_connections WHERE login = '4001'").get() as { password_cipher: string | null }).password_cipher;
    assert.equal(cipher, null);
    for (const text of texts) {
      assert.ok(!text.includes(PASSWORD), text);
      assert.ok(!text.includes("password_cipher"), text);
      assert.ok(!text.includes("passwordCipher"), text);
    }
    assert.equal(texts.length, 9);
  });

  test("while connected, no response holds the cipher, and nor do audit events or exports", async () => {
    await signIn(userId);
    fakes.__mt5Fake.next = session({}, 4003);
    await routes.connect.POST(post({ login: "4003", server: "Test-Server", password: PASSWORD }));
    const id = accountOf("4003");
    const { password_cipher } = R.readForSync(id)!;
    const status = await (await routes.status.GET()).text();
    assert.ok(!status.includes(password_cipher!));
    const audit = JSON.stringify(db().prepare("SELECT * FROM audit_events").all());
    assert.ok(!audit.includes(PASSWORD) && !audit.includes(password_cipher!));
    const jobs = JSON.stringify(db().prepare("SELECT * FROM sync_jobs").all());
    assert.ok(!jobs.includes(PASSWORD) && !jobs.includes(password_cipher!));
    const exported = JSON.stringify(J.exportAll(userId));
    assert.ok(!exported.includes(PASSWORD) && !exported.includes(password_cipher!));
  });

  test("another user can't touch or see the connection", async () => {
    await signIn(userId);
    fakes.__mt5Fake.next = session({}, 4004);
    await routes.connect.POST(post({ login: "4004", server: "Test-Server", password: PASSWORD }));
    const id = accountOf("4004");
    await signIn(otherUserId);
    assert.equal((await routes.sync.POST(post({ accountId: id }))).status, 404);
    assert.equal((await routes.settings.PATCH(post({ accountId: id, enabled: false }, "PATCH"))).status, 404);
    assert.equal((await routes.disconnect.POST(post({ accountId: id }))).status, 404);
    assert.equal((await routes.positions.GET(new Request(`http://127.0.0.1/api/mt5/positions?accountId=${id}`))).status, 404);
    assert.deepEqual(JSON.parse(await (await routes.status.GET()).text()).connections, []);
    assert.ok(R.readForSync(id)!.password_cipher);
  });

  test("the same MT5 login under another user is a separate account", async () => {
    await signIn(otherUserId);
    fakes.__mt5Fake.next = session({}, 4004);
    const r = await routes.connect.POST(post({ login: "4004", server: "Test-Server", password: PASSWORD }));
    assert.equal(r.status, 201);
    assert.notEqual(R.findAccountId(otherUserId, "4004", "Test-Server"), accountOf("4004"));
  });

  test("connect is rate limited", async () => {
    await signIn(otherUserId);
    fakes.__mt5Fake.next = { ok: false, category: "wrong_password", code: -6 };
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await routes.connect.POST(post({ login: "4999", server: "Test-Server", password: "x" }))).status);
    assert.equal(statuses.at(-1), 429);
    assert.equal(statuses[0], 422);
  });

  test("settings reject an interval out of range", async () => {
    await signIn(userId);
    const r = await routes.settings.PATCH(post({ accountId: accountOf("4004"), intervalSeconds: 1 }, "PATCH"));
    assert.equal(r.status, 422);
  });
});

describe("read-only and no-secret guarantees in the source", () => {
  const ROOT = process.cwd();
  function files(dirPath: string): string[] {
    return readdirSync(dirPath).flatMap((f) => {
      const full = path.join(dirPath, f);
      if (f === ".venv" || f === "__pycache__") return [];
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  }
  const sources = [path.join(ROOT, "services", "mt5"), path.join(ROOT, "src", "lib", "server", "mt5"), path.join(ROOT, "src", "app", "api", "mt5")]
    .flatMap(files)
    .filter((f) => !f.endsWith(".test.ts"));

  test("the service holds no trading call", () => {
    const service = readFileSync(path.join(ROOT, "services", "mt5", "service.py"), "utf8");
    for (const banned of ["order_send", "order_check", "order_calc", "Close(", "positions_close", "TRADE_ACTION"]) assert.ok(!service.includes(banned), banned);
    for (const f of sources) assert.ok(!/order_send|order_check/.test(readFileSync(f, "utf8")), f);
  });

  test("the service only ever starts the dedicated terminal, by explicit path", () => {
    const service = readFileSync(path.join(ROOT, "services", "mt5", "service.py"), "utf8");
    const calls = service.match(/mt5\.initialize\([^)]*\)/g) ?? [];
    assert.deepEqual(calls, ["mt5.initialize(path=TERMINAL, portable=True, login=login, password=password, server=server, timeout=INIT_TIMEOUT_MS)"]);
  });

  test("the service binds to loopback and logs nothing", () => {
    const service = readFileSync(path.join(ROOT, "services", "mt5", "service.py"), "utf8");
    assert.match(service, /HTTPServer\(\("127\.0\.0\.1", 0\)/);
    assert.match(service, /compare_digest/);
    assert.equal((service.match(/print\(/g) ?? []).length, 1);
  });

  test("setup copies nothing from the user's terminal data, since its servers.dat signs a copy in to that account", () => {
    const setup = readFileSync(path.join(ROOT, "scripts", "setup-mt5.mjs"), "utf8");
    assert.equal((setup.match(/copyFileSync\(/g) ?? []).length, 1);
    assert.ok(!/copyFileSync\([^)]*(accounts|common\.ini|servers)/.test(setup));
    assert.ok(!setup.includes("APPDATA"));
  });

  test("routes don't touch the cipher, and the status query names its columns", () => {
    for (const f of sources.filter((s) => s.includes(`${path.sep}api${path.sep}`))) assert.ok(!/password_cipher|readForSync/.test(readFileSync(f, "utf8")), f);
    const repo = readFileSync(path.join(ROOT, "src", "lib", "server", "repo", "mt5.ts"), "utf8");
    assert.ok(!/SELECT c\.\*|SELECT \* FROM mt5_connections/.test(repo));
  });

  test("the ignored paths hold the terminal, the venv and the key", () => {
    const ignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    for (const p of ["/data/", "/.secrets/", "/services/mt5/.venv/"]) assert.ok(ignore.includes(p), p);
  });
});
