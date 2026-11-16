import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBackupPassword, makeBackupKeys, rewrap, seal, unseal } from "./backup-seal";
// The restore script reads the same format without the app: it must open what the app writes.
const script = (await import("../../../scripts/decrypt-backup.mjs")) as { unseal: (b: Buffer, p: string) => Buffer | null };

const keys = makeBackupKeys("first password 1");
const plain = Buffer.from("SQLite format 3\0 and then the journal");

test("a sealed backup opens with the password, and not without it", () => {
  const sealed = seal(plain, keys);
  assert.equal(sealed.includes(Buffer.from("the journal")), false, "nothing readable in the file");
  assert.deepEqual(unseal(sealed, "first password 1"), plain);
  assert.equal(unseal(sealed, "a wrong password"), null);
});

test("the restore script opens what the app sealed", () => {
  const sealed = seal(plain, keys);
  assert.deepEqual(script.unseal(sealed, "first password 1"), plain);
  assert.equal(script.unseal(sealed, "a wrong password"), null);
});

test("an altered backup is refused rather than half-read", () => {
  const sealed = seal(plain, keys);
  sealed[sealed.length - 3] ^= 0xff;
  assert.throws(() => unseal(sealed, "first password 1"));
});

test("a new password opens backups made before the change, and the old one stops working", () => {
  const before = seal(plain, keys);
  assert.equal(changeBackupPassword(keys, "not the password", "second password 2"), null);
  const changed = changeBackupPassword(keys, "first password 1", "second password 2")!;
  const after = seal(plain, changed);
  assert.deepEqual(unseal(after, "second password 2"), plain);
  assert.equal(unseal(after, "first password 1"), null);
  // Older files carry the old locked key until they're rewrapped with the new one.
  assert.deepEqual(unseal(before, "first password 1"), plain);
  const moved = rewrap(before, changed);
  assert.deepEqual(unseal(moved, "second password 2"), plain);
  assert.equal(unseal(moved, "first password 1"), null);
});
