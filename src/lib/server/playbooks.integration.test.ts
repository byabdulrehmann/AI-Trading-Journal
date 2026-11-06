import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-play-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { db } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const P = await import("./repo/playbooks");
const { loadSampleData } = await import("./sample");
const { TradeInput } = await import("@/lib/domain/types");
const { MissedInput, PlaybookInput } = await import("@/lib/domain/playbooks");
const { playbookStats } = await import("@/lib/domain/metrics");

let owner = 0;
let other = 0;
let account = 0;

before(async () => {
  db();
  owner = ((await createUser("o@example.test", "correct horse battery", "O")) as { id: number }).id;
  other = ((await createUser("x@example.test", "correct horse battery", "X")) as { id: number }).id;
  account = J.createAccount(owner, { name: "Main", broker: "", currency: "USD", startingBalance: 0 }).id;
});

after(() => {
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

const trade = (over: Record<string, unknown> = {}) =>
  TradeInput.parse({ accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000, ...over });
const input = (over: Record<string, unknown> = {}) => PlaybookInput.parse({ name: "Breakout", ...over });
let counter = 0;
const named = (rules: { group: string; text: string }[] = []) => P.createPlaybook(owner, input({ name: `Book ${++counter}`, rules }));
const RULES = [{ group: "Entry", text: "A" }, { group: "Exit", text: "B" }];

describe("playbooks", () => {
  test("a strategy named on a trade is the same playbook, not a second one", () => {
    const t = J.createTrade(owner, trade({ strategy: "Named on a trade" }));
    const p = P.listPlaybooks(owner, false).find((x) => x.name === "Named on a trade");
    assert.ok(p);
    assert.equal(P.tradeChecklist(owner, t.id)?.strategyId, p.id);
  });

  test("rules save in order, and a rule edited keeps its id", () => {
    const p = named(RULES);
    assert.deepEqual(p.rules.map((r) => r.text), ["A", "B"]);
    const [a, b] = p.rules;
    const next = P.updatePlaybook(owner, p.id, { rules: [{ id: b.id, group: "Exit", text: "B edited" }, { id: a.id, group: "Entry", text: "A" }, { group: "Risk", text: "C" }] })!;
    assert.deepEqual(next.rules.map((r) => r.text), ["B edited", "A", "C"]);
    assert.equal(next.rules[0].id, b.id);
  });

  test("a name in use is reported, and renaming to its own name isn't", () => {
    const p = named();
    assert.equal(P.playbookNameTaken(owner, p.name), true);
    assert.equal(P.playbookNameTaken(owner, p.name, p.id), false);
    assert.equal(P.playbookNameTaken(other, p.name), false);
  });

  test("renaming moves its trades with it", () => {
    const t = J.createTrade(owner, trade({ strategy: "Old name" }));
    const p = P.listPlaybooks(owner, false).find((x) => x.name === "Old name")!;
    P.updatePlaybook(owner, p.id, { name: "New name" });
    assert.equal(J.getTrade(owner, t.id)?.strategy, "New name");
  });

  test("deleting one keeps its trades and missed trades, with no playbook", () => {
    const t = J.createTrade(owner, trade({ strategy: "Going away" }));
    const p = P.listPlaybooks(owner, false).find((x) => x.name === "Going away")!;
    const m = P.createMissed(owner, MissedInput.parse({ strategyId: p.id, symbol: "A", side: "long", at: "2026-02-02T09:00:00Z", entryPrice: 10 }));
    assert.equal(P.deletePlaybook(owner, p.id), true);
    assert.equal(J.getTrade(owner, t.id)?.strategy, "");
    assert.equal(P.listMissed(owner, false).find((x) => x.id === m.id)?.strategyId, null);
  });

  test("another user can't read, change or delete it", () => {
    const p = named(RULES);
    assert.equal(P.getPlaybook(other, p.id), null);
    assert.equal(P.updatePlaybook(other, p.id, { name: "Theirs" }), null);
    assert.equal(P.deletePlaybook(other, p.id), false);
    assert.equal(P.listPlaybooks(other, true).some((x) => x.id === p.id), false);
  });
});

describe("a trade's checklist", () => {
  const setup = () => {
    const p = named(RULES);
    const t = J.createTrade(owner, trade({ strategy: p.name }));
    return { p, t };
  };

  test("starts unreviewed, and ticking stores an answer for every rule", () => {
    const { p, t } = setup();
    assert.equal(P.tradeChecklist(owner, t.id)?.reviewed, false);
    const saved = P.saveChecklist(owner, t.id, [p.rules[0].id])!;
    assert.equal(saved.reviewed, true);
    assert.deepEqual(saved.rules.map((r) => r.checked), [true, false]);
    assert.deepEqual(P.checklistTotals(owner).get(t.id), { done: 1, total: 2 });
  });

  test("clearing makes it unreviewed again, and it leaves the figures", () => {
    const { p, t } = setup();
    P.saveChecklist(owner, t.id, [p.rules[0].id]);
    assert.equal(P.saveChecklist(owner, t.id, null)?.reviewed, false);
    assert.equal(P.checklistTotals(owner).has(t.id), false);
  });

  test("a rule added later doesn't lower a trade already reviewed", () => {
    const { p, t } = setup();
    P.saveChecklist(owner, t.id, p.rules.map((r) => r.id));
    P.updatePlaybook(owner, p.id, { rules: [...p.rules, { group: "Risk", text: "New" }] });
    assert.deepEqual(P.checklistTotals(owner).get(t.id), { done: 2, total: 2 });
    assert.equal(playbookStats([J.getTrade(owner, t.id)!], P.checklistTotals(owner)).adherence, 1);
  });

  test("a rule removed takes its answers with it", () => {
    const { p, t } = setup();
    P.saveChecklist(owner, t.id, [p.rules[0].id]);
    P.updatePlaybook(owner, p.id, { rules: [p.rules[0]] });
    assert.deepEqual(P.checklistTotals(owner).get(t.id), { done: 1, total: 1 });
  });

  test("moving a trade to another playbook leaves the old answers out, and moving back brings them back", () => {
    const { p, t } = setup();
    P.saveChecklist(owner, t.id, p.rules.map((r) => r.id));
    J.bulkUpdateTrades(owner, [t.id], { type: "setStrategy", name: "Elsewhere" });
    assert.equal(P.checklistTotals(owner).has(t.id), false);
    assert.equal(P.tradeChecklist(owner, t.id)?.strategy, "Elsewhere");
    J.bulkUpdateTrades(owner, [t.id], { type: "setStrategy", name: p.name });
    assert.deepEqual(P.checklistTotals(owner).get(t.id), { done: 2, total: 2 });
  });

  test("a rule from another playbook is ignored", () => {
    const { t } = setup();
    const foreign = named(RULES).rules[0].id;
    assert.deepEqual(P.saveChecklist(owner, t.id, [foreign])?.rules.map((r) => r.checked), [false, false]);
  });

  test("another user's trade can't be read or answered", () => {
    const { p, t } = setup();
    assert.equal(P.tradeChecklist(other, t.id), null);
    assert.equal(P.saveChecklist(other, t.id, [p.rules[0].id]), null);
    assert.equal(P.checklistTotals(other).size, 0);
  });

  test("a synced trade can be reviewed", () => {
    const p = named(RULES);
    const t = J.createTrade(owner, trade({ strategy: p.name }), { source: "mt5", sourceKey: "pos:9" });
    assert.equal(P.saveChecklist(owner, t.id, [p.rules[0].id])?.reviewed, true);
  });

  test("a trade with no playbook has no checklist to answer", () => {
    const t = J.createTrade(owner, trade());
    assert.deepEqual(P.tradeChecklist(owner, t.id), { strategyId: null, strategy: null, reviewed: false, rules: [] });
  });
});

describe("missed trades", () => {
  test("stored with their R, never as trades", () => {
    const before = J.listTrades(owner).length;
    const m = P.createMissed(owner, MissedInput.parse({ symbol: "aapl", side: "long", at: "2026-02-02T09:00:00Z", entryPrice: 100, stopPrice: 98, exitPrice: 106, reason: "Hesitated" }));
    assert.deepEqual([m.symbol, m.r, m.reason], ["AAPL", 3, "Hesitated"]);
    assert.equal(J.listTrades(owner).length, before);
  });

  test("another user can't see or delete them", () => {
    const m = P.createMissed(owner, MissedInput.parse({ symbol: "B", side: "long", at: "2026-02-02T09:00:00Z", entryPrice: 10 }));
    assert.equal(P.listMissed(other, true).length, 0);
    assert.equal(P.deleteMissed(other, m.id), false);
    assert.equal(P.deleteMissed(owner, m.id), true);
  });
});

describe("sample playbooks", () => {
  test("come with rules, answers and missed trades, stay hidden, and leave your own alone", async () => {
    const u = ((await createUser("s@example.test", "correct horse battery", "S")) as { id: number }).id;
    const a = J.createAccount(u, { name: "Mine", broker: "", currency: "USD", startingBalance: 0 });
    // A name the sample also uses: it stays the user's, with the user's rules.
    const mine = P.createPlaybook(u, input({ name: "Range fade", rules: [{ group: "Entry", text: "My own rule" }] }));
    J.createTrade(u, trade({ accountId: a.id, strategy: "Range fade" }));

    loadSampleData(u);
    const shown = P.listPlaybooks(u, true);
    assert.ok(shown.length >= 5);
    const sampleBook = shown.find((p) => p.name === "VWAP pullback")!;
    assert.equal(sampleBook.isSample, true);
    assert.ok(sampleBook.rules.length >= 4);
    assert.deepEqual(P.getPlaybook(u, mine.id)?.rules.map((r) => r.text), ["My own rule"]);
    assert.equal(P.getPlaybook(u, mine.id)?.isSample, false);
    assert.ok(P.checklistTotals(u).size > 50);
    assert.ok(P.listMissed(u, true).length >= 16);

    assert.deepEqual(P.listPlaybooks(u, false).map((p) => p.name), ["Range fade"]);
    assert.equal(P.listMissed(u, false).length, 0);

    J.removeSampleData(u);
    assert.deepEqual(P.listPlaybooks(u, true).map((p) => p.name), ["Range fade"]);
    assert.equal(P.listMissed(u, true).length, 0);
    assert.deepEqual(P.getPlaybook(u, mine.id)?.rules.map((r) => r.text), ["My own rule"]);
  });

  test("delete everything and the export cover playbooks", async () => {
    const u = ((await createUser("d@example.test", "correct horse battery", "D")) as { id: number }).id;
    const a = J.createAccount(u, { name: "Mine", broker: "", currency: "USD", startingBalance: 0 });
    const p = P.createPlaybook(u, input({ rules: RULES }));
    const t = J.createTrade(u, trade({ accountId: a.id, strategy: p.name }));
    P.saveChecklist(u, t.id, [p.rules[0].id]);
    P.createMissed(u, MissedInput.parse({ strategyId: p.id, symbol: "A", side: "long", at: "2026-02-02T09:00:00Z", entryPrice: 10 }));
    const e = J.exportAll(u);
    assert.deepEqual([e.strategyRules.length, e.tradeRuleChecks.length, e.missedTrades.length], [2, 2, 1]);
    J.deleteAllData(u);
    assert.equal(P.listPlaybooks(u, true).length, 0);
    assert.equal(P.listMissed(u, true).length, 0);
  });
});
