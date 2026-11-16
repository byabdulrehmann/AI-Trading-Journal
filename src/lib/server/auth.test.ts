import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// auth.ts opens the database lazily; point it at a temp folder so nothing can reach data/.
process.env.KESTREL_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "jarvis-auth-")), "test.db");
const { nextDeadline, rateLimited, slots } = await import("./auth");

test("slots never run more than their limit at once, and every job finishes in order of arrival", async () => {
  const run = slots(2);
  let active = 0;
  let peak = 0;
  const done: number[] = [];
  const job = (i: number) => async () => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    done.push(i);
    return i;
  };
  const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => run(job(i))));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.equal(done.length, 6);
});

test("a failing job still frees its slot", async () => {
  const run = slots(1);
  await assert.rejects(run(async () => Promise.reject(new Error("boom"))));
  assert.equal(await run(async () => "next"), "next");
});

test("rate limits take their own ceiling and window", async () => {
  const key = `test:${Math.random()}`;
  assert.equal([1, 2, 3].map(() => rateLimited(key, 3, 60_000)).includes(true), false);
  assert.equal(rateLimited(key, 3, 60_000), true);
  const short = `test:${Math.random()}`;
  rateLimited(short, 1, 20);
  assert.equal(rateLimited(short, 1, 20), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rateLimited(short, 1, 20), false, "a new window starts once the old one ends");
});

test("a session's deadline slides with use, at most hourly, and never past 14 days from sign-in", () => {
  const day = 86400000;
  const signedIn = Date.parse("2026-11-01T00:00:00Z");
  const iso = (t: number) => new Date(t).toISOString();
  // Used 10 minutes after the deadline was last set: not worth a write.
  assert.equal(nextDeadline(iso(signedIn), iso(signedIn + 3 * day), signedIn + 10 * 60000), null);
  // Used two hours later: three days from now.
  assert.equal(nextDeadline(iso(signedIn), iso(signedIn + 3 * day), signedIn + 2 * 3600000), iso(signedIn + 2 * 3600000 + 3 * day));
  // Near the end: capped at 14 days after sign-in.
  assert.equal(nextDeadline(iso(signedIn), iso(signedIn + 13 * day), signedIn + 12 * day), iso(signedIn + 14 * day));
  // A session from before the idle limit (14-day deadline) is pulled in to three days from its next use.
  assert.equal(nextDeadline(iso(signedIn), iso(signedIn + 14 * day), signedIn + day), iso(signedIn + 4 * day));
});
