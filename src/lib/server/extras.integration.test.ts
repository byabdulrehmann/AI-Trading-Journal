import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-extras-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const { updateSettings } = await import("./repo/settings");
const A = await import("./autotag");
const N = await import("./news");
const Rv = await import("./reviews");
const B = await import("./backup");
const { PROVIDERS } = await import("./ai/registry");
const { TagRuleInput } = await import("@/lib/domain/autotag");
const { parseEventsCsv } = await import("@/lib/domain/econ");
const { TradeInput } = await import("@/lib/domain/types");

let owner = 0;
let other = 0;
let main = 0;

const trade = (symbol: string, openedAt: string, minutes: number, exitPrice: number, extra: object = {}) =>
  J.createTrade(owner, TradeInput.parse({ accountId: main, symbol, side: "long", openedAt, closedAt: new Date(Date.parse(openedAt) + minutes * 60_000).toISOString(), entryPrice: 100, exitPrice, stopPrice: 99, quantity: 1, ...extra }));

before(async () => {
  db();
  owner = ((await createUser("x@example.test", "correct horse battery", "X")) as { id: number }).id;
  other = ((await createUser("y@example.test", "correct horse battery", "Y")) as { id: number }).id;
  updateSettings(owner, { timeZone: "UTC" });
  main = J.createAccount(owner, { name: "Live", broker: "", currency: "USD", startingBalance: 10000 }).id;
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auto-tags", () => {
  test("a new rule tags the trades already there, and new trades as they close", () => {
    const quick = trade("EURUSD", "2026-03-02T09:00:00.000Z", 3, 98);
    const slow = trade("EURUSD", "2026-03-02T10:00:00.000Z", 90, 102);
    const r = A.createRule(owner, TagRuleInput.parse({ tag: "Quick loss", conditions: [{ field: "hold", op: "under", value: "5" }, { field: "r", op: "under", value: "0" }] }));
    assert.equal(r.tagged, 1);
    assert.deepEqual(J.getTrade(owner, quick.id)!.tags, ["Quick loss"]);
    assert.deepEqual(J.getTrade(owner, slow.id)!.tags, []);
    const later = trade("GBPUSD", "2026-03-03T09:00:00.000Z", 2, 99.5);
    assert.deepEqual(later.tags, ["Quick loss"]);
  });

  test("a tag the trader removed stays removed, and other users' rules never touch these trades", () => {
    const t = J.listTrades(owner).find((x) => x.tags.includes("Quick loss"))!;
    J.updateTrade(owner, t.id, TradeInput.parse({ ...t, tags: [], executions: null }));
    assert.deepEqual(J.getTrade(owner, t.id)!.tags, []);
    J.recalculateTrade(t.id);
    assert.deepEqual(J.getTrade(owner, t.id)!.tags, []);
    A.createRule(other, TagRuleInput.parse({ tag: "Theirs", conditions: [{ field: "symbol", op: "contains", value: "USD" }] }));
    assert.ok(J.listTrades(owner).every((x) => !x.tags.includes("Theirs")));
    assert.equal(A.deleteRule(other, A.listRules(owner)[0].id), false);
  });

  test("a news rule tags trades once the calendar has the event", () => {
    const t = trade("EURUSD", "2026-03-06T13:25:00.000Z", 30, 101);
    A.createRule(owner, TagRuleInput.parse({ tag: "News", conditions: [{ field: "news", op: "within", value: "15" }] }));
    assert.ok(!J.getTrade(owner, t.id)!.tags.includes("News"));
    const csv = parseEventsCsv("date,time,currency,event,impact\n2026-03-06,13:30,USD,Non-farm payrolls,High\n2026-03-06,13:30,JPY,Something,High\n", { zone: "UTC" });
    const r = N.importEvents(owner, csv.events);
    assert.deepEqual([r.added, r.skipped], [2, 0]);
    assert.ok(J.getTrade(owner, t.id)!.tags.includes("News"));
    // The same file again adds nothing.
    assert.deepEqual([N.importEvents(owner, csv.events).added, N.importEvents(owner, csv.events).skipped], [0, 2]);
    // Around the trade: the USD event counts for EURUSD, the JPY one doesn't.
    assert.deepEqual(N.eventsNearTrade(owner, t.id)!.map((e) => e.currency), ["USD"]);
    assert.equal(N.eventsNearTrade(other, t.id), null);
    assert.equal(N.listEvents(other).length, 0);
  });
});

describe("reviews", () => {
  test("the week's facts come from the record, and no model means no written review", async () => {
    const r = Rv.getReview(owner, "week", "2026-03-04");
    assert.deepEqual([r.from, r.to, r.currencies[0].currency, r.currencies[0].facts.closedTrades, r.ai.available], ["2026-03-02", "2026-03-08", "USD", 4, false]);
    assert.equal(r.currencies[0].facts.netPnl, -2 + 2 - 0.5 + 1);
    const w = await Rv.writeReview(owner, "week", "2026-03-04", false, AbortSignal.timeout(5000));
    assert.equal(w.ok, false);
  });

  test("with a model connected, it writes the review from the record and saves it", async () => {
    let sent = "";
    PROVIDERS.push({
      id: "fake", label: "Fake", defaultModel: "fake-1", status: () => ({ configured: true, external: true }), listModels: async () => [{ id: "fake-1", displayName: "Fake" }],
      async *stream(req) {
        sent = req.messages[0].content;
        yield "Recorded: 4 trades. ";
        yield "Suggestion: keep the stop.";
      },
    });
    updateSettings(owner, { jarvis: { ...(await import("./repo/settings")).getSettings(owner).jarvis, provider: "fake", model: "fake-1", sharing: "metrics" } });
    const w = await Rv.writeReview(owner, "week", "2026-03-04", false, AbortSignal.timeout(5000));
    assert.ok(w.ok);
    assert.equal(w.saved.text, "Recorded: 4 trades. Suggestion: keep the stop.");
    // Sharing set to metrics only: no individual trades went out.
    assert.match(sent, /"trades":\[\]/);
    assert.equal(Rv.getReview(owner, "week", "2026-03-06").saved?.model, "fake-1");
    assert.equal(Rv.getReview(other, "week", "2026-03-06").saved, null);
  });
});

describe("backups", () => {
  test("a copy of the database, listed, and only names of real backups resolve", () => {
    const b = B.createBackup("manual");
    assert.equal(b.kind, "manual");
    assert.ok(b.size > 0);
    assert.ok(B.backupPath(b.name));
    for (const bad of ["../test.db", "kestrel-x/../../test.db", "test.db", "kestrel-nope.db"]) assert.equal(B.backupPath(bad), null, bad);
  });

  test("one automatic backup a day, the last seven kept", () => {
    assert.ok(B.autoBackupIfDue());
    assert.equal(B.autoBackupIfDue(), null);
    const folder = path.dirname(B.backupPath(B.listBackups()[0].name)!);
    for (let i = 0; i < 8; i++) {
      // Age the newest so the next one is due.
      const last = B.listBackups().find((x) => x.kind === "auto")!;
      const old = new Date(Date.now() - (i + 2) * 86_400_000);
      utimesSync(path.join(folder, last.name), old, old);
      B.createBackup("auto");
    }
    assert.equal(B.listBackups().filter((x) => x.kind === "auto").length, 7);
  });
});

describe("delete everything", () => {
  test("clears events, rules and reviews too", () => {
    J.deleteAllData(owner);
    for (const t of ["economic_events", "tag_rules", "ai_reviews"]) assert.equal((db().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(owner) as { n: number }).n, 0, t);
    assert.equal(A.listRules(other).length, 1);
  });
});
