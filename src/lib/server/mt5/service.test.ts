import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

/**
 * The real service, pointed at a folder with no usable terminal, so nothing MT5 ever starts:
 * every session here must stop at the path check, before initialize or login.
 */
const PYTHON = path.join(process.cwd(), "services", "mt5", ".venv", "Scripts", "python.exe");
const SERVICE = path.join(process.cwd(), "services", "mt5", "service.py");
const TOKEN = "test-token-not-a-secret";
const PASSWORD = "invalid-Secret-123";

function start(terminal: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(PYTHON, ["-I", SERVICE], {
    env: { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, MT5_SERVICE_TOKEN: TOKEN, MT5_TERMINAL_PATH: terminal } as unknown as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout!.once("data", (d) => resolve({ child, url: `http://127.0.0.1:${String(d).trim()}` }));
  });
}

const session = (url: string, body: unknown, token = TOKEN) =>
  fetch(`${url}/session`, { method: "POST", headers: { "x-mt5-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });
const valid = { login: 1, server: "Invalid-Server", password: PASSWORD, from: 946684800 };

describe("service.py with no dedicated terminal", { skip: !existsSync(PYTHON) && "needs node scripts/setup-mt5.mjs" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "jarvis-svc-"));
  let missing: { child: ChildProcess; url: string };
  let unmarked: { child: ChildProcess; url: string };

  before(async () => {
    missing = await start(path.join(dir, "absent", "terminal64.exe"));
    // A file with the right name but no portable.txt beside it, as in a normal install. It is never run.
    writeFileSync(path.join(dir, "terminal64.exe"), "");
    unmarked = await start(path.join(dir, "terminal64.exe"));
  });

  after(async () => {
    for (const s of [missing, unmarked]) {
      const gone = new Promise((r) => s.child.once("exit", r));
      s.child.stdin!.end();
      await gone;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("needs the token, on both endpoints", async () => {
    assert.equal((await fetch(`${missing.url}/health`)).status, 401);
    assert.equal((await session(missing.url, valid, "wrong")).status, 401);
  });

  test("health says the terminal is absent", async () => {
    const r = await (await fetch(`${missing.url}/health`, { headers: { "x-mt5-token": TOKEN } })).json();
    assert.equal(r.ok, true);
    assert.equal(r.terminal_exists, false);
  });

  test("a missing terminal is a clear setup error, not a fallback", async () => {
    const r = await (await session(missing.url, valid)).json();
    assert.deepEqual([r.ok, r.category], [false, "terminal_missing"]);
    assert.match(r.message, /setup-mt5/);
  });

  test("a folder without the setup marker is refused, so a normal install can't be used", async () => {
    const r = await (await session(unmarked.url, valid)).json();
    assert.deepEqual([r.ok, r.category], [false, "terminal_missing"]);
  });

  test("bad input is refused without echoing it", async () => {
    for (const body of [{ ...valid, login: "1" }, { ...valid, login: 0 }, { ...valid, server: "" }, { ...valid, password: "" }, { ...valid, from: -1 }, {}]) {
      const res = await session(missing.url, body);
      assert.equal(res.status, 422);
      assert.ok(!(await res.text()).includes(PASSWORD));
    }
  });

  test("no password in any answer", async () => {
    assert.ok(!(await (await session(missing.url, valid)).text()).includes(PASSWORD));
  });
});
