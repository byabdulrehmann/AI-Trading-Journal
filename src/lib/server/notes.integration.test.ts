import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";

/** Real SQLite in a temp folder. Never touches data/. */
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-notes-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { db, purgeDeletedTrades } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const N = await import("./repo/notes");
const { loadSampleData } = await import("./sample");
const { TradeInput } = await import("@/lib/domain/types");
const { NOTE_TEMPLATES, NoteInput, VERSIONS_KEPT, previewOf, shouldSnapshot } = await import("@/lib/domain/notes");

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

const trade = () => J.createTrade(owner, TradeInput.parse({ accountId: account, symbol: "EURUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", closedAt: "2026-02-02T10:00:00.000Z", entryPrice: 1.1, exitPrice: 1.11, quantity: 1000 }));
const note = (over: Record<string, unknown> = {}, user = owner) => N.createNote(user, NoteInput.parse({ title: "T", body: "B", ...over }));
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();

describe("when a version is kept", () => {
  test("never for no change, first time for a change, then only after the gap", () => {
    assert.equal(shouldSnapshot(false, null, at(0)), false);
    assert.equal(shouldSnapshot(true, null, at(0)), true);
    assert.equal(shouldSnapshot(true, at(0), at(4)), false);
    assert.equal(shouldSnapshot(true, at(0), at(5)), true);
  });

  test("a preview flattens lines and cuts long text", () => {
    assert.equal(previewOf("a\n\nb  c"), "a b c");
    assert.equal(previewOf("x".repeat(200), 10), `${"x".repeat(10)}...`);
  });

  test("a preview leaves out formatting marks", () => {
    assert.equal(previewOf("## Plan\n\n- first\n- [x] done\n- [ ] not\n1. one\n\n**bold** word"), "Plan first done not one bold word");
    assert.equal(previewOf("a - b # c"), "a - b # c");
  });
});

describe("notes", () => {
  test("save, read back and update", () => {
    const n = note({ tags: ["a", "a", "b"] });
    assert.deepEqual(n.tags, ["a", "b"]);
    const u = N.updateNote(owner, n.id, { title: "New", body: "Changed" })!;
    assert.deepEqual([u.title, u.body, u.tags], ["New", "Changed", ["a", "b"]]);
  });

  test("another user can't read, change or delete one", () => {
    const n = note();
    assert.equal(N.getNote(other, n.id), null);
    assert.equal(N.updateNote(other, n.id, { title: "Theirs" }), null);
    assert.equal(N.setNoteDeleted(other, n.id, true), false);
    assert.equal(N.getNote(owner, n.id)?.title, "T");
  });

  test("search covers titles, text and tags, and % is a plain character", () => {
    note({ title: "Findable title" });
    note({ body: "somewhere in the findable-body text" });
    note({ tags: ["findable-tag"] });
    note({ title: "Up 100% today" });
    assert.equal(N.listNotes(owner, { q: "findable" }).length, 3);
    assert.equal(N.listNotes(owner, { q: "100%" }).length, 1);
    assert.equal(N.listNotes(owner, { q: "zz%zz" }).length, 0);
  });

  test("deleted notes leave lists, can come back, and go for good after 30 days", () => {
    const n = note({ title: "Short lived" });
    assert.equal(N.setNoteDeleted(owner, n.id, true), true);
    assert.equal(N.getNote(owner, n.id), null);
    assert.equal(N.listNotes(owner, { q: "Short lived" }).length, 0);
    assert.equal(N.setNoteDeleted(owner, n.id, false), true);
    assert.equal(N.getNote(owner, n.id)?.title, "Short lived");

    N.setNoteDeleted(owner, n.id, true);
    db().prepare("UPDATE notes SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(n.id);
    purgeDeletedTrades(db());
    assert.equal(N.setNoteDeleted(owner, n.id, false), false);
  });

  test("the body limit is enforced", () => {
    assert.equal(NoteInput.safeParse({ body: "x".repeat(100_001) }).success, false);
  });
});

describe("versions", () => {
  test("an edit after a pause keeps what it replaced, a burst keeps one", () => {
    const n = N.createNote(owner, NoteInput.parse({ title: "V", body: "one" }), at(0));
    N.updateNote(owner, n.id, { body: "two" }, at(10));
    N.updateNote(owner, n.id, { body: "three" }, at(11));
    N.updateNote(owner, n.id, { body: "four" }, at(12));
    const v = N.getNote(owner, n.id)!.versions;
    assert.equal(v.length, 1);
    assert.equal(v[0].preview, "one");
    N.updateNote(owner, n.id, { body: "five" }, at(20));
    assert.deepEqual(N.getNote(owner, n.id)!.versions.map((x) => x.preview), ["four", "one"]);
  });

  test("moving folder or changing tags alone keeps no version", () => {
    const n = N.createNote(owner, NoteInput.parse({ body: "x" }), at(0));
    N.updateNote(owner, n.id, { tags: ["t"] }, at(60));
    assert.equal(N.getNote(owner, n.id)!.versions.length, 0);
  });

  test("restoring brings it back, and keeps what was there so it can be undone", () => {
    const n = N.createNote(owner, NoteInput.parse({ title: "Old title", body: "old" }), at(0));
    N.updateNote(owner, n.id, { title: "New title", body: "new" }, at(10));
    const version = N.getNote(owner, n.id)!.versions[0].id;
    const back = N.restoreVersion(owner, n.id, version, at(20))!;
    assert.deepEqual([back.title, back.body], ["Old title", "old"]);
    assert.equal(back.versions[0].preview, "new");
    assert.equal(N.restoreVersion(owner, n.id, back.versions[0].id, at(21))?.body, "new");
  });

  test("another note's version, or another user, can't be restored", () => {
    const a = N.createNote(owner, NoteInput.parse({ body: "a" }), at(0));
    N.updateNote(owner, a.id, { body: "a2" }, at(10));
    const b = note();
    const version = N.getNote(owner, a.id)!.versions[0].id;
    assert.equal(N.restoreVersion(owner, b.id, version), null);
    assert.equal(N.restoreVersion(other, a.id, version), null);
  });

  test("only the latest are kept", () => {
    const n = N.createNote(owner, NoteInput.parse({ body: "0" }), at(0));
    for (let i = 1; i <= VERSIONS_KEPT + 5; i++) N.updateNote(owner, n.id, { body: String(i) }, at(i * 10));
    const v = N.getNote(owner, n.id)!.versions;
    assert.equal(v.length, VERSIONS_KEPT);
    assert.equal(v[0].preview, String(VERSIONS_KEPT + 4));
  });
});

describe("links", () => {
  test("a note shows from its trade and its day, and a link can come later", () => {
    const t = trade();
    const n = note();
    assert.equal(N.listNotes(owner, { tradeId: t.id }).length, 0);
    N.updateNote(owner, n.id, { links: [{ kind: "trade", tradeId: t.id }, { kind: "day", day: "2026-03-02" }] });
    assert.deepEqual(N.listNotes(owner, { tradeId: t.id }).map((x) => x.id), [n.id]);
    assert.deepEqual(N.listNotes(owner, { day: "2026-03-02" }).map((x) => x.id), [n.id]);
    const links = N.getNote(owner, n.id)!.links;
    assert.match(links[0].label, /EURUSD, #\d+/);
    assert.equal(links[1].day, "2026-03-02");
  });

  test("the same link twice is one link", () => {
    const n = note({ links: [{ kind: "day", day: "2026-03-03" }, { kind: "day", day: "2026-03-03" }] });
    assert.equal(n.links.length, 1);
  });

  test("a link to another user's trade isn't stored", () => {
    const n = note({}, other);
    const t = trade();
    assert.equal(N.updateNote(other, n.id, { links: [{ kind: "trade", tradeId: t.id }] })?.links.length, 0);
  });

  test("a deleted trade's link hides, and comes back with it. The note stays either way", () => {
    const t = trade();
    const n = note({ links: [{ kind: "trade", tradeId: t.id }] });
    J.setTradesDeleted(owner, [t.id], true);
    assert.equal(N.getNote(owner, n.id)?.links.length, 0);
    J.setTradesDeleted(owner, [t.id], false);
    assert.equal(N.getNote(owner, n.id)?.links.length, 1);
  });
});

describe("folders and templates", () => {
  test("deleting a folder keeps its notes, in no folder", () => {
    const f = N.createFolder(owner, "Going");
    const n = note({ folderId: f });
    assert.deepEqual(N.listNotes(owner, { folderId: f }).map((x) => x.id), [n.id]);
    assert.equal(N.listFolders(owner, false).find((x) => x.id === f)?.count, 1);
    assert.equal(N.deleteFolder(owner, f), true);
    assert.equal(N.getNote(owner, n.id)?.folderId, null);
    assert.ok(N.listNotes(owner, { folderId: "none" }).some((x) => x.id === n.id));
  });

  test("names are per user, and a folder can't be touched by another", () => {
    const f = N.createFolder(owner, "Shared name");
    assert.equal(N.folderNameTaken(owner, "Shared name"), true);
    assert.equal(N.folderNameTaken(owner, "Shared name", f), false);
    assert.equal(N.folderNameTaken(other, "Shared name"), false);
    assert.equal(N.renameFolder(other, f, "Theirs"), false);
    assert.equal(N.deleteFolder(other, f), false);
    assert.equal(N.folderBelongs(other, f), false);
  });

  test("templates are per user", () => {
    const id = N.createTemplate(owner, "Mine", "body");
    assert.equal(N.templateNameTaken(owner, "Mine"), true);
    assert.equal(N.listTemplates(other).length, 0);
    assert.equal(N.deleteTemplate(other, id), false);
    assert.equal(N.deleteTemplate(owner, id), true);
    assert.ok(NOTE_TEMPLATES.length >= 4);
  });
});

describe("sample notes and the whole journal", () => {
  test("stay hidden, are linked, and leave with the sample data, keeping your own", async () => {
    const u = ((await createUser("s@example.test", "correct horse battery", "S")) as { id: number }).id;
    J.createAccount(u, { name: "Mine", broker: "", currency: "USD", startingBalance: 0 });
    const mine = note({ title: "Mine" }, u);
    loadSampleData(u);
    const shown = N.listNotes(u, { includeSample: true });
    assert.ok(shown.length >= 3);
    assert.equal(N.listNotes(u).length, 1);
    assert.deepEqual(N.listFolders(u, false), []);
    const recap = shown.find((n) => n.title.includes("worst trade"))!;
    assert.equal(N.getNote(u, recap.id)?.links[0].kind, "trade");

    J.removeSampleData(u);
    assert.deepEqual(N.listNotes(u, { includeSample: true }).map((n) => n.id), [mine.id]);
    assert.deepEqual(N.listFolders(u, true), []);
  });

  test("the export holds notes and their history, and delete everything removes them", async () => {
    const u = ((await createUser("d@example.test", "correct horse battery", "D")) as { id: number }).id;
    const f = N.createFolder(u, "F");
    const n = N.createNote(u, NoteInput.parse({ body: "one", folderId: f, links: [{ kind: "day", day: "2026-03-02" }] }), at(0));
    N.updateNote(u, n.id, { body: "two" }, at(10));
    N.createTemplate(u, "T", "x");
    const e = J.exportAll(u);
    assert.deepEqual([e.notes.length, e.noteFolders.length, e.noteTemplates.length, e.noteVersions.length, e.noteLinks.length], [1, 1, 1, 1, 1]);
    J.deleteAllData(u);
    const left = new DatabaseSync(process.env.KESTREL_DB_PATH as string, { readOnly: true });
    assert.equal((left.prepare("SELECT COUNT(*) AS n FROM notes WHERE user_id = ?").get(u) as { n: number }).n, 0);
    assert.equal((left.prepare("SELECT COUNT(*) AS n FROM note_versions WHERE note_id = ?").get(n.id) as { n: number }).n, 0);
    assert.equal((left.prepare("SELECT COUNT(*) AS n FROM note_folders WHERE user_id = ?").get(u) as { n: number }).n, 0);
    left.close();
  });
});
