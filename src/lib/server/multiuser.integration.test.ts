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
const { currentAiKey, hasFreeKey, keyFor, saveFreeKey, saveOwnKey, setSharingOwnerKey, withAiKey } = await import("./ai/key");
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
      return currentAiKey("anthropic");
    });
    assert.equal(seen, "sk-ant-their-own");
    assert.equal(currentAiKey("anthropic"), null);
    delete process.env.ANTHROPIC_API_KEY;
    saveOwnKey(other.id, null);
    assert.equal(withAiKey(other.id, () => currentAiKey("anthropic")), null, "no key anywhere: demo mode");
  });

  test("free providers use only the account's own key, encrypted, per provider and per account", () => {
    saveFreeKey(other.id, "groq", "gsk_their-groq-key");
    assert.equal(withAiKey(other.id, () => currentAiKey("groq")), "gsk_their-groq-key");
    assert.equal(withAiKey(other.id, () => currentAiKey("gemini")), null, "one provider's key isn't another's");
    assert.equal(withAiKey(owner.id, () => currentAiKey("groq")), null, "never shared, not even by the owner");
    const stored = (db().prepare("SELECT key_cipher FROM ai_keys WHERE user_id = ?").get(other.id) as { key_cipher: string }).key_cipher;
    assert.ok(!stored.includes("their-groq"), "not readable in the database");
    saveFreeKey(other.id, "groq", null);
    assert.equal(hasFreeKey(other.id, "groq"), false);
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
