import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder that starts one migration behind. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-found-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { MIGRATIONS, db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const { updateSettings } = await import("./repo/settings");
const { buildSampleTrades, loadSampleData } = await import("./sample");
const { TradeInput } = await import("@/lib/domain/types");
const { computeMetrics } = await import("@/lib/domain/metrics");

let owner = 0;
let account = 0;

before(async () => {
  const old = new DatabaseSync(process.env.KESTREL_DB_PATH as string);
  old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const m of MIGRATIONS.filter((x) => x.version < 4)) {
    old.exec(m.sql);
    old.prepare("INSERT INTO schema_migrations VALUES (?, ?, 'x')").run(m.version, m.name);
  }
  old.close();
  db();
  owner = ((await createUser("o@example.test", "correct horse battery", "O")) as { id: number }).id;
  account = J.createAccount(owner, { name: "Main", broker: "", currency: "USD", startingBalance: 0 }).id;
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const trade = (over: Record<string, unknown> = {}) =>
  TradeInput.parse({ accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000, ...over });

describe("migration 4", () => {
  test("backs up the journal first and keeps the older versions recorded", () => {
    const backups = readdirSync(path.join(dir, "backups"));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^kestrel-before-migration-4-/);
    const copy = new DatabaseSync(path.join(dir, "backups", backups[0]), { readOnly: true });
    assert.equal((copy.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v, 3);
    copy.close();
    assert.equal((db().prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v, MIGRATIONS.at(-1)?.version);
  });
});

describe("options", () => {
  const option = { symbol: "AAPL C190", assetClass: "option", multiplier: 100, entryPrice: 4.2, exitPrice: 5.7, quantity: 2, commission: 2.6 };

  test("an option needs its right, strike and expiry", () => {
    const r = TradeInput.safeParse({ accountId: 1, side: "long", openedAt: "2026-02-02T09:00:00Z", ...option, closedAt: "2026-02-02T10:00:00Z" });
    assert.equal(r.success, false);
    assert.deepEqual(r.error?.issues.map((i) => i.path[0]).sort(), ["expiry", "optionRight", "strike"]);
  });

  test("details are stored, and P&L uses the 100 multiplier", () => {
    const t = J.createTrade(owner, trade({ ...option, optionRight: "call", strike: 190, expiry: "2026-03-20" }));
    assert.deepEqual([t.optionRight, t.strike, t.expiry], ["call", 190, "2026-03-20"]);
    assert.equal(t.pnl, 297.4); // 1.50 x 2 x 100 - 2.60
  });

  test("details on a non-option are dropped", () => {
    const t = J.createTrade(owner, trade({ optionRight: "put", strike: 5, expiry: "2026-03-20" }));
    assert.deepEqual([t.optionRight, t.strike, t.expiry], [null, null, null]);
  });
});

describe("filters", () => {
  let ids: Record<string, number>;
  before(() => {
    const add = (name: string, over: Record<string, unknown>) => [name, J.createTrade(owner, trade({ symbol: "FILTER", ...over })).id] as const;
    ids = Object.fromEntries([
      add("a", { mistakes: ["fomo", "oversized"], emotionBefore: "calm", grade: "A", stopPrice: 1.09, assetClass: "stock", closedAt: "2026-02-02T09:03:00.000Z" }), // +1R, held 3 min
      add("b", { mistakes: ["fomo"], emotionBefore: "anxious", grade: "F", stopPrice: 1.105, exitPrice: 1.09, side: "short", assetClass: "future", closedAt: "2026-02-02T09:45:00.000Z", entryPrice: 1.1 }), // short: stop above entry
      add("c", { emotionBefore: "calm", assetClass: "crypto", closedAt: "2026-02-03T09:00:00.000Z" }), // no stop, held a day
    ]);
  });
  const found = (f: Record<string, unknown>) => J.listTrades(owner, { symbol: "FILTER", ...f }).map((t) => t.id).sort();
  const of = (...names: string[]) => names.map((n) => ids[n]).sort();

  test("mistake matches inside the list", () => {
    assert.deepEqual(found({ mistake: "fomo" }), of("a", "b"));
    assert.deepEqual(found({ mistake: "oversized" }), of("a"));
  });

  test("emotion, grade and asset class", () => {
    assert.deepEqual(found({ emotion: "calm" }), of("a", "c"));
    assert.deepEqual(found({ grade: "F" }), of("b"));
    assert.deepEqual(found({ assetClass: "future" }), of("b"));
  });

  test("R from is included, R below is not, and no stop means no match", () => {
    const r = J.listTrades(owner, { symbol: "FILTER" }).find((t) => t.id === ids.a)?.rMultiple as number;
    assert.equal(r, 1);
    assert.deepEqual(found({ rMin: 1 }), of("a", "b"));
    assert.deepEqual(found({ rMax: 1 }), []);
    assert.deepEqual(found({ rMin: 0.5, rMax: 1.5 }), of("a"));
  });

  test("holding time bands", () => {
    assert.deepEqual(found({ holdMax: 5 }), of("a"));
    assert.deepEqual(found({ holdMin: 5, holdMax: 60 }), of("b"));
    assert.deepEqual(found({ holdMin: 1440 }), of("c"));
  });

  test("weekday and hour follow the chosen time zone", () => {
    const late = J.createTrade(owner, trade({ symbol: "ZONED", openedAt: "2026-07-01T02:30:00.000Z", closedAt: "2026-07-01T03:00:00.000Z" })).id;
    updateSettings(owner, { timeZone: "UTC" });
    assert.deepEqual(J.listTrades(owner, { symbol: "ZONED", weekday: 3, hour: 2 }).map((t) => t.id), [late]); // Wednesday in UTC
    updateSettings(owner, { timeZone: "America/New_York" });
    assert.deepEqual(J.listTrades(owner, { symbol: "ZONED", weekday: 2, hour: 22 }).map((t) => t.id), [late]); // Tuesday evening in New York
    assert.deepEqual(J.listTrades(owner, { symbol: "ZONED", weekday: 3 }), []);
    updateSettings(owner, { timeZone: "" });
  });
});

describe("settings", () => {
  test("an unknown time zone and a negative fee are refused", () => {
    assert.throws(() => updateSettings(owner, { timeZone: "Mars/Olympus" }));
    assert.throws(() => updateSettings(owner, { feeDefaults: { commission: -1, otherFees: 0 } }));
  });
});

describe("sample journal", () => {
  const today = new Date("2026-11-06T12:00:00Z");

  test("is hundreds of trades across assets, accounts, strategies, tags and months", () => {
    const all = buildSampleTrades([1, 2, 3], today);
    assert.ok(all.length >= 300, `only ${all.length}`);
    assert.deepEqual(new Set(all.map((t) => t.accountId)), new Set([1, 2, 3]));
    for (const c of ["forex", "metal", "index", "stock", "option", "future", "crypto"]) assert.ok(all.some((t) => t.assetClass === c), c);
    assert.ok(new Set(all.map((t) => t.strategy).filter(Boolean)).size >= 5);
    assert.ok(new Set(all.flatMap((t) => t.tags)).size >= 5);
    assert.ok(new Set(all.map((t) => t.openedAt.slice(0, 7))).size >= 9);
    assert.ok(all.some((t) => t.executions?.length));
    assert.ok(all.some((t) => t.closedAt === null));
    assert.ok(all.every((t) => t.closedAt === null || Date.parse(t.closedAt) < today.getTime()), "nothing closes in the future");
    assert.ok(all.every((t) => t.assetClass !== "option" || (t.optionRight && t.strike && t.expiry)));
  });

  test("is repeatable", () => {
    assert.deepEqual(buildSampleTrades([1, 2, 3], today), buildSampleTrades([1, 2, 3], today));
  });

  test("stays out of real figures, and removing it leaves the user's own trades exactly as they were", () => {
    const own = computeMetrics(J.listTrades(owner));
    const added = loadSampleData(owner);
    assert.ok(added >= 300);
    assert.equal(J.listAccounts(owner).filter((a) => a.isSample).length, 3);
    assert.deepEqual(computeMetrics(J.listTrades(owner)).netPnl, own.netPnl);
    const sample = J.listTrades(owner, { source: "sample" });
    assert.equal(sample.length, added);
    assert.ok(sample.every((t) => t.pnlStatus === "ok"), "every sample trade has a known P&L");
    assert.ok(sample.filter((t) => t.status === "closed").every((t) => t.pnl !== null));
    assert.equal(loadSampleData(owner), 0, "loading twice adds nothing");

    assert.equal(J.removeSampleData(owner), added);
    assert.equal(J.listAccounts(owner).filter((a) => a.isSample).length, 0);
    assert.equal(computeMetrics(J.listTrades(owner)).netPnl, own.netPnl);
  });
});
