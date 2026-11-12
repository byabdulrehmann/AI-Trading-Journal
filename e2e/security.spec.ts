import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect, OWNER_EMAIL, PASSWORD, signUp, test } from "./helpers";

/**
 * Abuse cases, run against the real server: no session, a forged session, and a second user aiming at the owner's
 * records. Every route that takes an id or a reference is listed here; a new one should be added.
 */

const ID = "999999";
/** Every API route and method, ids filled in. The auth routes are public by design and tested elsewhere. */
const ROUTES: [string, string][] = [
  ["PATCH", "accounts/ID"], ["GET", "accounts"], ["POST", "accounts"], ["GET", "activity"], ["DELETE", "activity"], ["GET", "analytics"],
  ["GET", "attachments/ID"], ["DELETE", "attachments/ID"], ["POST", "backtests/ID/close"], ["POST", "backtests/ID/orders"], ["GET", "backtests/ID"],
  ["DELETE", "backtests/ID"], ["POST", "backtests/ID/step"], ["GET", "backtests"], ["POST", "backtests"], ["GET", "backups/kestrel-x.db"],
  ["DELETE", "backups/kestrel-x.db"], ["GET", "backups"], ["POST", "backups"], ["PUT", "challenges/ID"], ["DELETE", "challenges/ID"], ["GET", "challenges"],
  ["POST", "challenges"], ["GET", "daily"], ["PUT", "daily"], ["GET", "dashboard/live"], ["GET", "data"], ["DELETE", "data"], ["POST", "data/sample"],
  ["DELETE", "data/sample"], ["DELETE", "events/ID"], ["POST", "events/import"], ["GET", "events"], ["POST", "events"], ["DELETE", "events"],
  ["POST", "excursions"], ["DELETE", "expenses/ID"], ["GET", "expenses"], ["POST", "expenses"], ["GET", "facets"], ["DELETE", "goals/ID"], ["POST", "goals"],
  ["GET", "imports/ID/errors"], ["DELETE", "imports/ID"], ["GET", "imports"], ["POST", "imports"], ["GET", "instruments"], ["POST", "jarvis/chat"],
  ["GET", "jarvis/context"], ["GET", "jarvis/conversations/ID"], ["DELETE", "jarvis/conversations/ID"], ["GET", "jarvis/conversations"],
  ["DELETE", "jarvis/conversations"], ["PATCH", "jarvis/memories/ID"], ["DELETE", "jarvis/memories/ID"], ["GET", "jarvis/memories"], ["POST", "jarvis/memories"],
  ["DELETE", "jarvis/memories"], ["GET", "jarvis/providers"], ["POST", "jarvis/providers"], ["GET", "market"], ["DELETE", "missed/ID"], ["GET", "missed"],
  ["POST", "missed"], ["POST", "mt5/connect"], ["POST", "mt5/disconnect"], ["GET", "mt5/positions"], ["PATCH", "mt5/settings"], ["GET", "mt5/status"],
  ["POST", "mt5/sync"], ["GET", "notes/ID"], ["PATCH", "notes/ID"], ["POST", "notes/ID"], ["DELETE", "notes/ID"], ["PATCH", "notes/folders/ID"],
  ["DELETE", "notes/folders/ID"], ["POST", "notes/folders"], ["GET", "notes"], ["POST", "notes"], ["DELETE", "notes/templates/ID"], ["POST", "notes/templates"],
  ["GET", "notifications"], ["PATCH", "playbooks/ID"], ["DELETE", "playbooks/ID"], ["GET", "playbooks"], ["POST", "playbooks"], ["GET", "progress"],
  ["GET", "reconcile"], ["POST", "reconcile"], ["GET", "replay/day"], ["GET", "reviews"], ["POST", "reviews"], ["PATCH", "routine/ID"], ["PUT", "routine/checks"],
  ["GET", "routine"], ["POST", "routine"], ["GET", "settings"], ["PATCH", "settings"], ["DELETE", "tag-rules/ID"], ["GET", "tag-rules"], ["POST", "tag-rules"],
  ["POST", "trades/ID/attachments"], ["GET", "trades/ID/bars"], ["GET", "trades/ID"], ["PUT", "trades/ID"],
  ["POST", "trades/ID"], ["GET", "trades/ID/rules"], ["PUT", "trades/ID/rules"], ["POST", "trades/bulk"], ["POST", "trades/delete"], ["GET", "trades/export"],
  ["GET", "trades"], ["POST", "trades"], ["GET", "early-access"], ["DELETE", "early-access/ID"],
];
// Public by design: the website's early-access form. Covered in site.spec.ts.

const call = (r: APIRequestContext, method: string, path: string, data?: unknown) => r.fetch(`/api/${path}`, { method, data: method === "GET" ? undefined : (data ?? {}) });

test("every API route refuses a request with no session, or with a forged one", async ({ page, playwright, baseURL }) => {
  const bare = await playwright.request.newContext({ baseURL });
  const forged = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: "jarvis_session=forged-token-that-was-never-issued" } });
  // Even a real session's token stops working once it's signed out.
  const stolen = (await page.context().cookies()).find((c) => c.name === "jarvis_session")!.value;
  const copy = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `jarvis_session=${stolen}` } });
  expect((await copy.get("/api/settings")).status()).toBe(200);
  expect((await page.request.post("/api/auth/logout")).ok()).toBe(true);

  const open: string[] = [];
  for (const [method, path] of ROUTES) {
    for (const [who, ctx] of [["no session", bare], ["forged", forged], ["signed-out copy", copy]] as const) {
      const status = (await call(ctx, method, path.replace("ID", ID))).status();
      if (status !== 401) open.push(`${method} ${path} with ${who}: ${status}`);
    }
  }
  expect(open).toEqual([]);
  await Promise.all([bare.dispose(), forged.dispose(), copy.dispose()]);
});

test("changes from another site, or to another host name, are turned away before any route runs", async ({ page, baseURL }) => {
  const evil = { origin: "https://evil.example" };
  expect((await page.request.post("/api/trades/delete", { data: { ids: [1], deleted: true }, headers: evil })).status()).toBe(403);
  expect((await page.request.patch("/api/settings", { data: { theme: "dark" }, headers: { "sec-fetch-site": "cross-site" } })).status()).toBe(403);
  // DNS rebinding: a page on another name that resolves to this computer.
  expect((await page.request.get("/api/settings", { headers: { host: "rebind.example:3107" } })).status()).toBe(403);
  expect((await page.request.get(`${baseURL}/api/settings`)).status()).toBe(200);
});

const owner = async (page: Page) => expect((await page.request.post("/api/auth/login", { data: { email: OWNER_EMAIL, password: PASSWORD } })).status()).toBe(200);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API answers of many shapes, read field by field below.
const json = async (res: APIResponse): Promise<Record<string, any>> => {
  expect(res.ok(), `${res.url()}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
};
/** The owner's whole record, minus what changes by itself: the export's own time and the activity log. */
const snapshot = async (page: Page) => {
  const { exportedAt, activityLog, ...rest } = await json(await page.request.get("/api/data"));
  void exportedAt;
  void activityLog;
  return rest;
};

test("a second user can't read, change or delete anything of the owner's, by id or by reference", async ({ page }) => {
  test.setTimeout(180_000);
  const r = page.request;
  const account = (await json(await r.post("/api/accounts", { data: { name: "Owner's account", currency: "USD" } }))).account.id as number;
  const trade = (await json(await r.post("/api/trades", { data: { accountId: account, symbol: "AAPL", side: "long", openedAt: "2026-07-06T13:30:00.000Z", closedAt: "2026-07-06T14:00:00.000Z", entryPrice: 100, exitPrice: 101, stopPrice: 99, quantity: 1, notes: "private" } }))).trade;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const attachment = (await json(await r.post(`/api/trades/${trade.id}/attachments`, { multipart: { kind: "chart", file: { name: "chart.png", mimeType: "image/png", buffer: png } } }))).attachment.id as number;
  const folder = (await json(await r.post("/api/notes/folders", { data: { name: "Mine" } }))).id as number;
  const note = (await json(await r.post("/api/notes", { data: { title: "Secret plan", folderId: folder, links: [{ kind: "trade", tradeId: trade.id }] } }))).note.id as number;
  const template = (await json(await r.post("/api/notes/templates", { data: { name: "Mine", body: "x" } }))).id as number;
  const playbook = (await json(await r.post("/api/playbooks", { data: { name: "Mine", rules: [{ group: "Entry", text: "Rule" }] } }))).playbook.id as number;
  const challengeInput = { accountId: account, name: "Funded", startDate: "2026-07-01", accountSize: 10000, dailyLoss: 500, maxLoss: 1000 };
  const challenge = (await json(await r.post("/api/challenges", { data: challengeInput }))).challenge.id as number;
  const expense = (await json(await r.post("/api/expenses", { data: { date: "2026-07-01", kind: "fee", amount: 99, currency: "USD", challengeId: challenge } }))).expense.id as number;
  const goal = (await json(await r.post("/api/goals", { data: { kind: "win_rate", period: "week", target: 50, accountId: account } }))).id as number;
  const missed = (await json(await r.post("/api/missed", { data: { strategyId: playbook, symbol: "MSFT", side: "long", at: "2026-07-06T13:30:00.000Z", entryPrice: 100 } }))).missed.id as number;
  const memory = (await json(await r.post("/api/jarvis/memories", { data: { kind: "rule", content: "My own rule" } }))).memory.id as number;
  await json(await r.post("/api/events", { data: { at: "2026-07-06T12:30:00.000Z", currency: "USD", title: "CPI", impact: "high" } }));
  const event = (await json(await r.get("/api/events?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z"))).events[0].id as number;
  await json(await r.post("/api/tag-rules", { data: { tag: "Long", conditions: [{ field: "side", op: "is", value: "long" }] } }));
  const rule = (await json(await r.get("/api/tag-rules"))).rules[0].id as number;
  const step = (await json(await r.post("/api/routine", { data: { label: "Check news" } }))).item.id as number;
  const backup = (await json(await r.post("/api/backups"))).backup.name as string;
  const before = await snapshot(page);

  await signUp(page, "Intruder");
  const theirAccount = (await json(await r.get("/api/accounts"))).accounts[0].id as number;
  const attacks: [string, string, unknown?][] = [
    ["GET", `trades/${trade.id}`], ["PUT", `trades/${trade.id}`, { ...trade, accountId: theirAccount, notes: "changed", executions: null }], ["POST", `trades/${trade.id}`],
    ["GET", `trades/${trade.id}/bars`], ["GET", `trades/${trade.id}/rules`], ["PUT", `trades/${trade.id}/rules`, { checked: [] }],
    ["GET", `attachments/${attachment}`], ["DELETE", `attachments/${attachment}`], ["PATCH", `accounts/${account}`, { name: "changed" }],
    ["PUT", `challenges/${challenge}`, { ...challengeInput, accountId: theirAccount, name: "changed" }], ["DELETE", `challenges/${challenge}`],
    ["DELETE", `expenses/${expense}`], ["DELETE", `goals/${goal}`], ["DELETE", `missed/${missed}`],
    ["GET", `notes/${note}`], ["PATCH", `notes/${note}`, { title: "changed" }], ["POST", `notes/${note}`, { versionId: 1 }], ["DELETE", `notes/${note}`],
    ["PATCH", `notes/folders/${folder}`, { name: "changed" }], ["DELETE", `notes/folders/${folder}`], ["DELETE", `notes/templates/${template}`],
    ["PATCH", `playbooks/${playbook}`, { name: "changed" }], ["DELETE", `playbooks/${playbook}`],
    ["PATCH", `jarvis/memories/${memory}`, { content: "changed by someone else" }], ["DELETE", `jarvis/memories/${memory}`],
    ["DELETE", `events/${event}`], ["DELETE", `tag-rules/${rule}`], ["PATCH", `routine/${step}`, { label: "changed" }],
    ["GET", `backups/${backup}`], ["DELETE", `backups/${backup}`], ["GET", `mt5/positions?accountId=${account}`],
    ["PATCH", "mt5/settings", { accountId: account, enabled: false }], ["POST", "mt5/disconnect", { accountId: account }], ["POST", "mt5/sync", { accountId: account }],
    ["GET", `dashboard/live?accountId=${account}`], ["GET", `analytics?accountId=${account}`], ["GET", `trades?accountId=${account}`],
    // By reference, inside a body: each must be refused rather than linked to the owner's record.
    ["POST", "trades", { accountId: account, symbol: "X", side: "long", openedAt: "2026-07-06T13:30:00.000Z", entryPrice: 1, quantity: 1 }],
    ["POST", "trades/delete", { ids: [trade.id], deleted: true }], ["POST", "trades/bulk", { ids: [trade.id], action: { type: "addTag", name: "pwned" } }],
    ["POST", "trades/bulk", { ids: [trade.id], action: { type: "moveAccount", accountId: theirAccount } }],
    ["POST", "notes", { title: "x", folderId: folder, links: [{ kind: "trade", tradeId: trade.id }] }],
    ["POST", "expenses", { date: "2026-07-01", kind: "fee", amount: 1, currency: "USD", challengeId: challenge }],
    ["POST", "goals", { kind: "win_rate", period: "week", target: 50, accountId: account }],
    ["POST", "missed", { strategyId: playbook, symbol: "X", side: "long", at: "2026-07-06T13:30:00.000Z", entryPrice: 1 }],
    ["POST", "challenges", { ...challengeInput, name: "theirs" }],
  ];
  const leaks: string[] = [];
  for (const [method, path, data] of attacks) {
    const res = await call(r, method, path, data);
    const text = await res.text();
    // Reads must fail outright, and nothing the owner wrote may come back in any answer.
    if (method === "GET" && res.ok() && !/dashboard\/live|analytics|trades\?/.test(path)) leaks.push(`${method} ${path}: ${res.status()}`);
    if (/Secret plan|private|My own rule|Owner's account|Funded/.test(text)) leaks.push(`${method} ${path} returned the owner's data`);
  }
  expect(leaks).toEqual([]);
  // A note made with the owner's trade linked keeps no link to it.
  const theirNotes = (await json(await r.get("/api/notes"))).notes as { id: number }[];
  for (const n of theirNotes) expect((await json(await r.get(`/api/notes/${n.id}`))).note.links).toEqual([]);

  await owner(page);
  expect(await snapshot(page)).toEqual(before);
});

test("pages carry the security headers, and the session cookie can't be read by scripts or sent by other sites", async ({ page, playwright, baseURL }) => {
  const res = await page.request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["x-powered-by"]).toBeUndefined();

  const fresh = await playwright.request.newContext({ baseURL });
  const login = await fresh.post("/api/auth/login", { data: { email: OWNER_EMAIL, password: PASSWORD } });
  const cookie = login.headers()["set-cookie"];
  expect(cookie).toMatch(/jarvis_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
  expect(cookie).toMatch(/Path=\//);
  await fresh.dispose();
});

test("guessing a password is cut off after eight tries, and the answer doesn't say whether the email exists", async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  const email = `nobody-${Date.now()}@example.test`;
  const statuses: number[] = [];
  for (let i = 0; i < 9; i++) statuses.push((await ctx.post("/api/auth/login", { data: { email, password: `guess-${i}-xxxxxxxx` } })).status());
  expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
  expect(statuses[8]).toBe(429);
  // An unknown email and a known one with a wrong password read the same.
  const unknown = await (await ctx.post("/api/auth/login", { data: { email: `other-${Date.now()}@example.test`, password: "wrong-password-1" } })).json();
  const known = await (await ctx.post("/api/auth/login", { data: { email: OWNER_EMAIL, password: "wrong-password-1" } })).json();
  expect(unknown).toEqual(known);
  await ctx.dispose();
});
