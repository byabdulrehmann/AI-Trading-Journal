import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { decrypt, encrypt, masterKey } from "./crypto";

const key = randomBytes(32);

describe("password encryption", () => {
  test("round trip, with a new IV each time", () => {
    const [a, b] = [encrypt("pässword-1", key), encrypt("pässword-1", key)];
    assert.equal(decrypt(a, key), "pässword-1");
    assert.notEqual(a, b);
    assert.ok(!a.includes("password"));
  });

  test("any altered part fails", () => {
    const parts = encrypt("secret", key).split(".");
    for (let i = 0; i < 3; i++) {
      const bytes = Buffer.from(parts[i], "base64");
      bytes[0] ^= 1;
      const altered = parts.with(i, bytes.toString("base64")).join(".");
      assert.throws(() => decrypt(altered, key));
    }
  });

  test("a different key fails", () => {
    assert.throws(() => decrypt(encrypt("secret", key), randomBytes(32)));
  });

  test("the key comes from the environment when set, and a bad one is refused", () => {
    process.env.JARVIS_ENCRYPTION_KEY = key.toString("base64");
    assert.deepEqual(masterKey(), key);
    process.env.JARVIS_ENCRYPTION_KEY = key.toString("hex");
    assert.deepEqual(masterKey(), key);
    process.env.JARVIS_ENCRYPTION_KEY = "too short";
    assert.throws(() => masterKey());
    delete process.env.JARVIS_ENCRYPTION_KEY;
  });

  test("otherwise a key file is created once and reused", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jarvis-key-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const first = masterKey();
      assert.equal(first.length, 32);
      assert.ok(existsSync(path.join(dir, ".secrets", "master.key")));
      assert.deepEqual(masterKey(), first);
      assert.equal(readFileSync(path.join(dir, ".secrets", "master.key"), "utf8"), first.toString("base64"));
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
