import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

/** Real SQLite in a temp folder, and a throwaway encryption key. Never touches data/ or the real key. */
process.env.KESTREL_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "jarvis-multi-")), "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { createUser } = await import("./auth");
const { currentAiKey, keyFor, saveOwnKey, setSharingOwnerKey, withAiKey } = await import("./ai/key");
const { db } = await import("./db");
const { pickNext } = await import("./mt5/queue");

const owner = (await createUser("owner@example.test", "correct horse battery", "Owner")) as { id: number };
const other = (await createUser("other@example.test", "correct horse battery", "Other")) as { id: number };

describe("whose Anthropic key a request uses", () => {
  test("the owner's key serves the owner, and everyone else only while it's shared", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-owner";
    assert.deepEqual(keyFor(owner.id), { key: "sk-ant-owner", own: false });
    assert.deepEqual(keyFor(other.id), { key: "sk-ant-owner", own: false });
    setSharingOwnerKey(false);
    assert.equal(keyFor(other.id), null);
    assert.deepEqual(keyFor(owner.id), { key: "sk-ant-owner", own: false });
    setSharingOwnerKey(true);
  });

  test("an account's own key wins, is stored encrypted, and removing it falls back", () => {
    saveOwnKey(other.id, "sk-ant-their-own");
    assert.deepEqual(keyFor(other.id), { key: "sk-ant-their-own", own: true });
    const stored = (db().prepare("SELECT anthropic_key_cipher FROM users WHERE id = ?").get(other.id) as { anthropic_key_cipher: string }).anthropic_key_cipher;
    assert.ok(!stored.includes("their-own"), "not readable in the database");
    saveOwnKey(other.id, null);
    assert.deepEqual(keyFor(other.id), { key: "sk-ant-owner", own: false });
  });

  test("the key follows the request through awaits, and is gone outside it", async () => {
    saveOwnKey(other.id, "sk-ant-their-own");
    const seen = await withAiKey(other.id, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentAiKey();
    });
    assert.equal(seen, "sk-ant-their-own");
    assert.equal(currentAiKey(), null);
    delete process.env.ANTHROPIC_API_KEY;
    saveOwnKey(other.id, null);
    assert.equal(withAiKey(other.id, () => currentAiKey()), null, "no key anywhere: demo mode");
  });
});

describe("the MT5 sync queue takes users in turn", () => {
  test("the user served longest ago goes next, oldest job first", () => {
    const waiting = [{ userId: 1 }, { userId: 1 }, { userId: 2 }, { userId: 3 }];
    assert.equal(pickNext(waiting, new Map()), 0, "nobody served yet: first come");
    assert.equal(pickNext(waiting, new Map([[1, 5]])), 2, "user 1 just had a turn");
    assert.equal(pickNext(waiting, new Map([[1, 5], [2, 6], [3, 7]])), 0, "user 1 waited longest since");
    assert.equal(pickNext([{ userId: 4 }], new Map([[4, 9]])), 0);
  });
});
