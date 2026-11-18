import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

/** Real SQLite in a temp folder, a throwaway encryption key, and a fake FRED. Never touches data/ or the network. */
process.env.KESTREL_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "jarvis-fred-")), "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { db } = await import("../db");
const { macro, refreshFred, saveFredKey } = await import("./fred");

const KEY = "a".repeat(32);
let failing = new Set<string>();
let calls = 0;
globalThis.fetch = (async (input: string | URL) => {
  calls++;
  const id = new URL(String(input)).searchParams.get("series_id")!;
  if (failing.has(id)) return Response.json({ error_message: "Bad Request. The series does not exist." }, { status: 400 });
  return Response.json({ observations: [{ date: "2026-10-01", value: "2.5" }, { date: "2026-09-01", value: "." }] });
}) as typeof fetch;

const saved = (id: string) => (db().prepare("SELECT COUNT(*) AS n FROM fred_observations WHERE series_id = ?").get(id) as { n: number }).n;

describe("FRED refresh", () => {
  test("a series FRED won't send doesn't stop the others, and it's named", async () => {
    db().prepare("DELETE FROM settings WHERE key = 'fred:fetched'").run();
    failing = new Set(["UNRATE"]);
    saveFredKey(KEY);
    await refreshFred();
    assert.equal(saved("FEDFUNDS"), 1, "the other series are saved, the '.' reading skipped");
    assert.equal(saved("UNRATE"), 0);
    assert.match(macro().notice ?? "", /FRED didn't send UNRATE\./);
  });

  test("a new key is used at once, even right after a failure", async () => {
    failing = new Set(["FEDFUNDS", "UNRATE"]);
    saveFredKey(KEY);
    calls = 0;
    await refreshFred();
    assert.ok(calls > 0, "fetched without waiting out the hour");
    calls = 0;
    await refreshFred();
    assert.equal(calls, 0, "done for today");
    failing = new Set();
    saveFredKey(KEY);
    await refreshFred();
    assert.equal(macro().notice, null);
    assert.equal(saved("UNRATE"), 1);
  });
});
