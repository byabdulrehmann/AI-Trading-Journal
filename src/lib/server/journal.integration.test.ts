import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/**
 * Runs against a real SQLite file that starts in the old schema with old rows in it,
 * so the migration is tested the way it will really run. Never touches data/.
 */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-test-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { MIGRATIONS, db } = await import("./db");
const { createUser, authenticate, verifyPassword, hashPassword } = await import("./auth");
const J = await import("./repo/journal");
const { getSettings, updateSettings } = await import("./repo/settings");
const { TradeInput } = await import("@/lib/domain/types");

const OLD_TRADE = `INSERT INTO trades (id, account_id, symbol, side, opened_at, closed_at, entry_price, exit_price, quantity, multiplier, stop_price, target_price, fees, setup, tags, notes, source, created_at, updated_at)
  VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'Breakout', ?, 'my note', 'manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;

before(() => {
  const old = new DatabaseSync(process.env.KESTREL_DB_PATH as string);
  old.exec(MIGRATIONS[0].sql);
  old.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  old.prepare("INSERT INTO schema_migrations VALUES (1, 'initial schema', '2026-01-01')").run();
  old.prepare("INSERT INTO accounts (id, name, currency, starting_balance, created_at) VALUES (1, 'Old account', 'USD', 1000, '2026-01-01')").run();
  old.prepare(OLD_TRADE).run(1, "EURUSD", "long", "2026-01-02T09:00:00.000Z", "2026-01-02T10:00:00.000Z", 1.085, 1.09, 100000, 1, 1.08, 7, '["keep-me"]');
  old.prepare(OLD_TRADE).run(2, "XAUUSD", "short", "2026-01-03T09:00:00.000Z", null, 2650, null, 1, 100, null, 0, "[]");
  old.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify({ displayName: "Abdul" }));
  old.close();
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const trade = (over: Record<string, unknown> = {}) =>
  TradeInput.parse({ accountId: 1, symbol: "EURUSD", side: "long", openedAt: "2026-02-01T09:00:00.000Z", closedAt: "2026-02-01T10:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1, multiplier: 100000, ...over });

describe("migration from the old schema", () => {
  let owner: number;
  before(async () => {
    db();
    const u = await createUser("owner@example.test", "correct horse battery", "Owner");
    assert.notEqual(u, "taken");
    owner = (u as { id: number }).id;
  });

  test("keeps every old trade, with values intact and results derived", () => {
    const [xau, eur] = J.listTrades(owner);
    assert.equal(eur.notes, "my note");
    assert.equal(eur.commission, 7);
    assert.deepEqual(eur.tags, ["keep-me"]);
    assert.equal(eur.status, "closed");
    assert.equal(eur.grossPnl, 500);
    assert.equal(eur.pnl, 493);
    assert.equal(xau.status, "open");
    assert.equal(xau.pnl, null);
  });

  test("gives old trades real fills", () => {
    const t = J.getTrade(owner, 1);
    assert.deepEqual(t?.executions?.map((e) => [e.role, e.price, e.quantity]), [["entry", 1.085, 100000], ["exit", 1.09, 100000]]);
  });

  test("the first user adopts old data and settings", () => {
    assert.equal(J.listAccounts(owner)[0].name, "Old account");
    assert.equal(getSettings(owner).displayName, "Abdul");
  });

  describe("users can't reach each other's data", () => {
    let other: number;
    before(async () => {
      other = ((await createUser("other@example.test", "another long password", "")) as { id: number }).id;
    });

    test("a second user starts empty and doesn't adopt anything", () => {
      assert.equal(J.listTrades(other).length, 0);
      assert.equal(J.listAccounts(other).length, 0);
      assert.equal(getSettings(other).displayName, "");
    });
    test("reads, updates and deletes of someone else's trade do nothing", () => {
      assert.equal(J.getTrade(other, 1), null);
      assert.equal(J.updateTrade(other, 1, trade()), null);
      assert.equal(J.duplicateTrade(other, 1), null);
      assert.equal(J.setTradesDeleted(other, [1], true), 0);
      assert.equal(J.getTrade(owner, 1)?.notes, "my note");
    });
    test("someone else's account is invisible", () => {
      assert.equal(J.getAccount(other, 1), null);
      assert.equal(J.updateAccount(other, 1, { archived: true }), null);
      assert.deepEqual(J.listInstruments(other, 1), []);
    });
    test("exports hold only their owner's rows", () => {
      assert.equal(J.exportAll(other).trades.length, 0);
      assert.ok(J.exportAll(owner).trades.length >= 2);
    });
    test("settings are per user", () => {
      updateSettings(other, { theme: "dark" });
      assert.equal(getSettings(owner).theme, "light");
    });
    test("deleting all data removes only that user's", () => {
      J.createAccount(other, { name: "Theirs", broker: "", currency: "EUR", startingBalance: 0 });
      J.deleteAllData(other);
      assert.equal(J.listAccounts(other).length, 0);
      assert.ok(J.listAccounts(owner).length > 0);
    });
  });

  describe("trades", () => {
    test("create, read back, edit: results recalculate", () => {
      const t = J.createTrade(owner, trade({ commission: 7, stopPrice: 1.09, strategy: "London break", tags: ["a"], strategyTags: ["s"] }));
      assert.equal(t.pnl, 993);
      assert.equal(t.rMultiple, 0.99);
      assert.equal(t.strategy, "London break");
      assert.deepEqual(t.strategyTags, ["s"]);
      assert.equal(t.session, "london");
      const edited = J.updateTrade(owner, t.id, trade({ exitPrice: 1.12, commission: 7, stopPrice: 1.09, strategy: "London break" }));
      assert.equal(edited?.pnl, 1993);
    });

    test("partial exits: realized on the closed part, still counted as open", () => {
      const t = J.createTrade(owner, trade({
        closedAt: null, exitPrice: null,
        executions: [
          { role: "entry", price: 1.1, quantity: 1, executedAt: "2026-02-02T09:00:00.000Z" },
          { role: "exit", price: 1.11, quantity: 0.4, executedAt: "2026-02-02T10:00:00.000Z" },
        ],
      }));
      assert.equal(t.status, "partial");
      assert.equal(t.remainingQty, 0.6);
      assert.equal(t.grossPnl, 400);
      assert.equal(t.closedAt, null);
    });

    test("scaling in and out aggregates to weighted averages", () => {
      const t = J.createTrade(owner, trade({
        executions: [
          { role: "entry", price: 1.1, quantity: 1, executedAt: "2026-02-03T09:00:00.000Z" },
          { role: "entry", price: 1.2, quantity: 1, executedAt: "2026-02-03T09:30:00.000Z" },
          { role: "exit", price: 1.3, quantity: 2, executedAt: "2026-02-03T11:00:00.000Z" },
        ],
      }));
      assert.equal(t.entryPrice, 1.15);
      assert.equal(t.quantity, 2);
      assert.equal(t.status, "closed");
      assert.equal(t.grossPnl, 30000);
      assert.equal(t.openedAt, "2026-02-03T09:00:00.000Z");
      assert.equal(t.closedAt, "2026-02-03T11:00:00.000Z");
    });

    test("a missing conversion rate is flagged and left out of P&L", () => {
      const t = J.createTrade(owner, trade({ symbol: "EURGBP" }));
      assert.equal(t.pnlStatus, "needs_rate");
      assert.equal(t.pnl, null);
    });

    test("duplicate makes a new manual trade with no broker link", () => {
      const a = J.createTrade(owner, trade({ notes: "copy me" }));
      const b = J.duplicateTrade(owner, a.id);
      assert.notEqual(b?.id, a.id);
      assert.equal(b?.notes, "copy me");
      assert.equal(b?.source, "manual");
    });

    test("delete hides, restore brings back, and old deletions are purged for good", () => {
      const a = J.createTrade(owner, trade());
      J.setTradesDeleted(owner, [a.id], true);
      assert.equal(J.getTrade(owner, a.id), null);
      J.setTradesDeleted(owner, [a.id], false);
      assert.ok(J.getTrade(owner, a.id));
      J.setTradesDeleted(owner, [a.id], true);
      db().prepare("UPDATE trades SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(a.id);
      J.setTradesDeleted(owner, [J.createTrade(owner, trade()).id], true);
      assert.equal(db().prepare("SELECT 1 FROM trades WHERE id = ?").get(a.id), undefined);
    });

    test("synced trades keep broker numbers: an edit changes annotations only", () => {
      const t = J.createTrade(owner, trade(), { source: "mt5", sourceKey: "pos-1" });
      const edited = J.updateTrade(owner, t.id, trade({ exitPrice: 9, quantity: 50, notes: "mine", stopPrice: 1.09, lessons: "learned" }));
      assert.equal(edited?.exitPrice, t.exitPrice);
      assert.equal(edited?.quantity, t.quantity);
      assert.equal(edited?.notes, "mine");
      assert.equal(edited?.lessons, "learned");
      assert.equal(edited?.stopPrice, 1.09);
    });

    test("the same source key can't be stored twice", () => {
      J.createTrade(owner, trade(), { source: "csv", sourceKey: "dup-1" });
      assert.throws(() => J.createTrade(owner, trade(), { source: "csv", sourceKey: "dup-1" }));
    });
  });

  describe("filters and paging", () => {
    test("pages through and counts everything", () => {
      const all = J.listTradesPage(owner, {}, "openedAt", "desc", 1, 3);
      assert.equal(all.trades.length, 3);
      assert.ok(all.total > 3);
      const second = J.listTradesPage(owner, {}, "openedAt", "desc", 2, 3);
      assert.notEqual(second.trades[0].id, all.trades[0].id);
    });
    test("filters by symbol, outcome and search", () => {
      assert.ok(J.listTrades(owner, { symbol: "XAUUSD" }).every((t) => t.symbol === "XAUUSD"));
      assert.ok(J.listTrades(owner, { outcome: "open" }).every((t) => t.status !== "closed"));
      assert.equal(J.listTrades(owner, { q: "keep-me" })[0].id, 1);
      assert.equal(J.listTrades(owner, { q: "#2" })[0].id, 2);
    });
    test("search treats SQL wildcards and injection as plain text", () => {
      assert.equal(J.listTrades(owner, { q: "%" }).length, 0);
      assert.equal(J.listTrades(owner, { q: "' OR 1=1 --" }).length, 0);
    });
    test("sample trades stay out unless asked for", () => {
      J.createTrade(owner, trade({ symbol: "GBPUSD" }), { source: "sample" });
      assert.equal(J.listTrades(owner, { symbol: "GBPUSD" }).length, 0);
      assert.equal(J.listTrades(owner, { symbol: "GBPUSD", includeSample: true }).length, 1);
    });
  });

  describe("reconciliation", () => {
    test("suggests the same trade from two sources, and never on time alone", () => {
      const at = { openedAt: "2026-03-01T09:00:00.000Z", closedAt: "2026-03-01T10:00:00.000Z", symbol: "USDCHF", entryPrice: 0.9, exitPrice: 0.91 };
      const manual = J.createTrade(owner, trade({ ...at, notes: "from manual" }));
      const synced = J.createTrade(owner, trade(at), { source: "mt5", sourceKey: "pos-9" });
      J.createTrade(owner, trade({ ...at, entryPrice: 0.95 }), { source: "csv" });
      const found = J.reconciliationCandidates(owner).filter((p) => p.a.symbol === "USDCHF");
      assert.equal(found.length, 1);
      assert.ok(J.resolveReconciliation(owner, synced.id, manual.id, "merged"));
      assert.equal(J.getTrade(owner, synced.id)?.notes, "from manual");
      assert.equal(J.getTrade(owner, manual.id), null);
      assert.equal(J.reconciliationCandidates(owner).filter((p) => p.a.symbol === "USDCHF").length, 0);
    });
  });

  describe("deleting removes the files too", () => {
    test("undoing an import and removing sample data delete attachment files", async () => {
      const { saveAttachment } = await import("./attachments");
      const { dataPath } = await import("./db");
      const { readdirSync } = await import("node:fs");
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const files = () => readdirSync(dataPath("attachments")).length;
      const before = files();
      const { batch } = J.importTrades(owner, 1, [{ trade: trade({ symbol: "NZDUSD" }), sourceKey: "attach-1" }], { filename: "x.csv", fileSha256: "x", storedName: null, format: "csv", adapter: "generic", options: {}, totalRows: 1, duplicates: 0, invalid: 0, errors: [] });
      const imported = J.listTrades(owner, { symbol: "NZDUSD" })[0];
      saveAttachment(owner, imported.id, { kind: "chart", filename: "a.png", bytes: png });
      assert.equal(files(), before + 1);
      J.undoImport(owner, batch);
      assert.equal(files(), before);
      const sample = J.createTrade(owner, trade({ symbol: "AUDNZD", fxRate: 1 }), { source: "sample" });
      saveAttachment(owner, sample.id, { kind: "chart", filename: "b.png", bytes: png });
      J.removeSampleData(owner);
      assert.equal(files(), before);
    });
    test("a download's name can't claim another type", async () => {
      const { saveAttachment } = await import("./attachments");
      const t = J.createTrade(owner, trade({ symbol: "CADCHF", fxRate: 1 }));
      const a = saveAttachment(owner, t.id, { kind: "chart", filename: "setup.exe", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]) });
      assert.equal(a.filename, "setup.png");
    });
  });

  describe("password change", () => {
    test("needs the current password, and ends every session", async () => {
      const { changePassword, startSession } = await import("./auth");
      void startSession;
      const u = (await createUser("change@example.test", "first long password", "")) as { id: number };
      db().prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h', ?, '2026', '2099')").run(u.id);
      assert.equal(await changePassword(u.id, "wrong", "second long password"), false);
      assert.ok(await authenticate("change@example.test", "first long password"));
      assert.equal(await changePassword(u.id, "first long password", "second long password"), true);
      assert.equal(await authenticate("change@example.test", "first long password"), null);
      assert.ok(await authenticate("change@example.test", "second long password"));
      assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(u.id) as { n: number }).n, 0);
    });
  });

  describe("auth", () => {
    test("right password in, wrong out, unknown email out", async () => {
      assert.equal((await authenticate("owner@example.test", "correct horse battery"))?.id, owner);
      assert.equal(await authenticate("owner@example.test", "wrong"), null);
      assert.equal(await authenticate("nobody@example.test", "correct horse battery"), null);
    });
    test("an email can't register twice, in any case", async () => {
      assert.equal(await createUser("OWNER@example.test", "correct horse battery", ""), "taken");
    });
    test("hashes are salted", async () => {
      const [a, b] = [await hashPassword("same password"), await hashPassword("same password")];
      assert.notEqual(a, b);
      assert.ok(await verifyPassword("same password", a));
      assert.equal(a.includes("same password"), false);
    });
  });
});
