import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// A temp database and attachment folder: never touches data/.
const dir = mkdtempSync(path.join(tmpdir(), "jarvis-attach-"));
process.env.KESTREL_DB_PATH = path.join(dir, "test.db");

const { db, dataPath } = await import("./db");
const { createUser } = await import("./auth");
const J = await import("./repo/journal");
const A = await import("./attachments");
const { TradeInput } = await import("@/lib/domain/types");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const PDF = Buffer.from("%PDF-1.7\nhello");
const HTML = Buffer.from("<!doctype html><script>alert(1)</script>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("attachments", () => {
  let owner = 0;
  let stranger = 0;
  let tradeId = 0;

  before(async () => {
    db();
    owner = ((await createUser("owner@example.test", "correct horse battery", "")) as { id: number }).id;
    stranger = ((await createUser("stranger@example.test", "correct horse battery", "")) as { id: number }).id;
    const account = J.createAccount(owner, { name: "Main", broker: "", currency: "USD", startingBalance: 0 });
    tradeId = J.createTrade(owner, TradeInput.parse({ accountId: account.id, symbol: "EURUSD", side: "long", openedAt: "2026-02-01T09:00:00.000Z", entryPrice: 1.1, quantity: 1000 })).id;
  });

  after(() => {
    db().close();
    rmSync(dir, { recursive: true, force: true });
  });

  const refused = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof A.AttachmentError && e.status === status);

  test("stores an allowed file and serves it back with the sniffed type", () => {
    const a = A.saveAttachment(owner, tradeId, { kind: "chart", filename: "entry.png", bytes: PNG });
    assert.equal(a.mime, "image/png");
    const read = A.readAttachment(owner, a.id);
    assert.deepEqual(read?.bytes, PNG);
    assert.equal(read?.mime, "image/png");
    assert.match(A.contentDisposition(read!.mime, read!.filename), /^inline; filename="entry.png"/);
  });

  test("the type comes from the bytes, not the name", () => {
    const a = A.saveAttachment(owner, tradeId, { kind: "document", filename: "looks-like.png", bytes: PDF });
    assert.equal(a.mime, "application/pdf");
    assert.match(A.contentDisposition(a.mime, a.filename), /^attachment;/);
  });

  test("refuses a renamed HTML file and SVG", () => {
    refused(() => A.saveAttachment(owner, tradeId, { kind: "chart", filename: "chart.png", bytes: HTML }), 415);
    refused(() => A.saveAttachment(owner, tradeId, { kind: "chart", filename: "chart.svg", bytes: SVG }), 415);
  });

  test("refuses empty and oversized files", () => {
    refused(() => A.saveAttachment(owner, tradeId, { kind: "chart", filename: "a.png", bytes: Buffer.alloc(0) }), 422);
    refused(() => A.saveAttachment(owner, tradeId, { kind: "chart", filename: "a.png", bytes: Buffer.concat([PNG, Buffer.alloc(A.MAX_ATTACHMENT_BYTES)]) }), 413);
  });

  test("path traversal in the filename is harmless", () => {
    const existing = new Set(readdirSync(dataPath("attachments")));
    const a = A.saveAttachment(owner, tradeId, { kind: "chart", filename: "..\\..\\../../etc/passwd\r\nX: y\".png", bytes: PNG });
    assert.equal(a.filename, "passwdX y.png");
    const added = readdirSync(dataPath("attachments")).filter((f) => !existing.has(f));
    assert.equal(added.length, 1);
    assert.match(added[0], /^[0-9a-f-]{36}\.png$/);
    assert.equal(existsSync(path.join(dir, "etc")), false);
  });

  test("another user can't add, read or delete", () => {
    const a = A.saveAttachment(owner, tradeId, { kind: "chart", filename: "mine.png", bytes: PNG });
    refused(() => A.saveAttachment(stranger, tradeId, { kind: "chart", filename: "x.png", bytes: PNG }), 404);
    assert.equal(A.readAttachment(stranger, a.id), null);
    assert.equal(A.deleteAttachment(stranger, a.id), false);
    assert.ok(A.readAttachment(owner, a.id));
  });

  test("delete removes the file and the row", () => {
    const count = readdirSync(dataPath("attachments")).length;
    const a = A.saveAttachment(owner, tradeId, { kind: "chart", filename: "gone.png", bytes: PNG });
    assert.equal(A.deleteAttachment(owner, a.id), true);
    assert.equal(readdirSync(dataPath("attachments")).length, count);
    assert.equal(A.readAttachment(owner, a.id), null);
    assert.equal(J.getTrade(owner, tradeId)?.attachments?.some((x) => x.id === a.id), false);
  });

  test("stops at the per-trade limit", () => {
    const fresh = J.createTrade(owner, TradeInput.parse({ accountId: J.listAccounts(owner)[0].id, symbol: "GBPUSD", side: "long", openedAt: "2026-02-02T09:00:00.000Z", entryPrice: 1.2, quantity: 1000 })).id;
    for (let i = 0; i < A.MAX_ATTACHMENTS_PER_TRADE; i++) A.saveAttachment(owner, fresh, { kind: "chart", filename: `${i}.png`, bytes: PNG });
    refused(() => A.saveAttachment(owner, fresh, { kind: "chart", filename: "more.png", bytes: PNG }), 422);
  });

  test("a soft-deleted trade's attachment isn't served", () => {
    const a = A.saveAttachment(owner, tradeId, { kind: "chart", filename: "hidden.png", bytes: PNG });
    J.setTradesDeleted(owner, [tradeId], true);
    assert.equal(A.readAttachment(owner, a.id), null);
    J.setTradesDeleted(owner, [tradeId], false);
    assert.ok(A.readAttachment(owner, a.id));
  });
});
