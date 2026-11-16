import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { db, now, transaction } from "./db";
import { audit } from "./repo/audit";

export interface User {
  id: number;
  email: string;
  name: string;
  isOwner: boolean;
}

export const COOKIE = "jarvis_session";
/** A session ends 14 days after sign-in, or after 3 days without use, whichever comes first. */
const SESSION_DAYS = 14;
const IDLE_DAYS = 3;
const DAY = 86400000;
/** The idle deadline moves forward at most once an hour, so reads don't each turn into a write. */
const SLIDE_MS = 3600000;
const COST = 2 ** 17;
const scryptOptions = (N: number) => ({ N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  name: z.string().trim().max(60).default(""),
});

/** Runs at most `max` jobs at once; the rest wait in order. A finished job hands its slot straight to the next. */
export function slots(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

// Each hash holds about 128 MB, so a burst of sign-ins queues instead of piling up memory.
const hashing = slots(2);

function derive(password: string, salt: Buffer, N: number): Promise<Buffer> {
  return hashing(() => new Promise((resolve, reject) => scrypt(password, salt, 32, scryptOptions(N), (err, key) => (err ? reject(err) : resolve(key)))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${COST}$${salt.toString("base64")}$${(await derive(password, salt, COST)).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, cost, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(cost));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = Record<string, unknown>;
const toUser = (r: Row): User => ({ id: r.id as number, email: r.email as string, name: r.name as string, isOwner: r.is_owner === 1 });

export const userCount = () => (db().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;

const OWNED_TABLES = ["accounts", "trades", "strategies", "tags", "jarvis_memories", "jarvis_conversations", "activity_log", "import_batches", "attachments", "reconciliations"];

/**
 * The first account becomes the owner and adopts everything already in the database,
 * so data from before accounts existed stays with the person who created it.
 */
export async function createUser(email: string, password: string, name: string): Promise<User | "taken"> {
  const hash = await hashPassword(password);
  const conn = db();
  return transaction(conn, () => {
    if (conn.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return "taken";
    const isOwner = userCount() === 0;
    const res = conn
      .prepare("INSERT INTO users (email, name, password_hash, is_owner, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(email, name, hash, isOwner ? 1 : 0, now());
    const id = Number(res.lastInsertRowid);
    if (isOwner) {
      for (const table of OWNED_TABLES) conn.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(id);
      conn.prepare("UPDATE settings SET key = ? WHERE key = 'app'").run(`app:${id}`);
    }
    audit(id, "user.created", "user", id);
    return { id, email, name, isOwner };
  });
}

// A real hash to compare against when the email is unknown, so timing doesn't reveal which emails exist.
const decoy = hashPassword(randomBytes(16).toString("hex"));

export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = db().prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
  const ok = await verifyPassword(password, row ? (row.password_hash as string) : await decoy);
  return row && ok ? toUser(row) : null;
}

export async function startSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  // The cookie lives as long as the session can; the server enforces the shorter idle deadline.
  const expires = new Date(Date.now() + SESSION_DAYS * DAY);
  const conn = db();
  conn.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
  conn.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now(), new Date(Date.now() + IDLE_DAYS * DAY).toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" && process.env.JARVIS_HTTPS === "1",
    path: "/",
    expires,
  });
}

export async function checkPassword(userId: number, password: string): Promise<boolean> {
  const row = db().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  return !!row && (await verifyPassword(password, row.password_hash));
}

/** Signs out every device, so a copied cookie stops working. The caller starts a fresh session. */
export async function changePassword(userId: number, current: string, next: string): Promise<boolean> {
  if (!(await checkPassword(userId, current))) return false;
  const hash = await hashPassword(next);
  transaction(db(), () => {
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    audit(userId, "password.changed", "user", userId);
  });
  return true;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  store.delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const hash = hashToken(token);
  const row = db()
    .prepare("SELECT u.*, s.created_at AS session_created, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .get(hash, now()) as Row | undefined;
  if (!row) return null;
  const deadline = nextDeadline(row.session_created as string, row.session_expires as string, Date.now());
  if (deadline) db().prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(deadline, hash);
  return toUser(row);
}

/** Where a used session's deadline should move, or null to leave it: idle time from now, never past the 14-day cap. */
export function nextDeadline(createdAt: string, expiresAt: string, at: number): string | null {
  const target = Math.min(Date.parse(createdAt) + SESSION_DAYS * DAY, at + IDLE_DAYS * DAY);
  const current = Date.parse(expiresAt);
  // Sessions from before the idle limit carry a 14-day deadline: pull those in too.
  return current > target || target - current > SLIDE_MS ? new Date(target).toISOString() : null;
}

export interface SessionInfo {
  id: number;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** The user's signed-in browsers. The id is the row number, never anything derived from the token. */
export async function listSessions(userId: number): Promise<SessionInfo[]> {
  const token = (await cookies()).get(COOKIE)?.value;
  const mine = token ? hashToken(token) : "";
  const rows = db().prepare("SELECT rowid AS id, token_hash, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(userId, now()) as Row[];
  return rows.map((r) => ({ id: r.id as number, createdAt: r.created_at as string, expiresAt: r.expires_at as string, current: r.token_hash === mine }));
}

/** Signs out one browser (by id) or every browser but this one (no id). Returns how many were signed out. */
export async function endOtherSessions(userId: number, id?: number): Promise<number> {
  const token = (await cookies()).get(COOKIE)?.value;
  const keep = token ? hashToken(token) : "";
  const res = id
    ? db().prepare("DELETE FROM sessions WHERE user_id = ? AND rowid = ? AND token_hash != ?").run(userId, id, keep)
    : db().prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, keep);
  const n = Number(res.changes);
  if (n) audit(userId, "sessions.ended", "user", userId, { count: n });
  return n;
}

/* ---------- who may create an account: anyone (the default) or nobody new, as the owner sets it ---------- */

const SIGNUP_KEY = "install:signup";
/** True unless the owner turned new accounts off. The very first account is always allowed by the caller. */
export const signupOpen = () => (db().prepare("SELECT value FROM settings WHERE key = ?").get(SIGNUP_KEY) as { value: string } | undefined)?.value !== "closed";
export function setSignupOpen(userId: number, open: boolean) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SIGNUP_KEY, open ? "open" : "closed");
  audit(userId, open ? "signup.opened" : "signup.closed");
}

/** A short one-way tag for an email: failed sign-ins to one address can be grouped without storing what was typed. */
export const emailTag = (email: string) => hashToken(`email:${email}`).slice(0, 12);

/** Every API route starts with this. Returns the signed-in user or the 401 to send back. */
export async function requireUser(): Promise<User | Response> {
  return (await currentUser()) ?? Response.json({ error: "Please sign in." }, { status: 401 });
}

/** For what belongs to the computer rather than to one user, such as early-access requests. */
export async function requireOwner(): Promise<User | Response> {
  const user = await requireUser();
  if (user instanceof Response || user.isOwner) return user;
  return Response.json({ error: "Only the owner of this installation can do that." }, { status: 403 });
}

const WINDOW_MS = 15 * 60000;
const MAX_ATTEMPTS = 8;

/**
 * True once `key` has been used more than `max` times in the window; each call counts as one use. Counts live in the
 * database, so a restart doesn't reset them and every server process sees the same ones.
 */
export function rateLimited(key: string, max = MAX_ATTEMPTS, windowMs = WINDOW_MS): boolean {
  const t = Date.now();
  const conn = db();
  // Keys hold whatever email was typed, so finished windows go before they can pile up.
  conn.prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(t);
  const { count } = conn
    .prepare("INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count")
    .get(key, t + windowMs) as { count: number };
  return count > max;
}

/** How many times `key` was used in its current window, without counting this look. */
export const rateCount = (key: string) =>
  (db().prepare("SELECT count FROM rate_limits WHERE key = ? AND reset_at >= ?").get(key, Date.now()) as { count: number } | undefined)?.count ?? 0;

export const clearRateLimit = (key: string) => db().prepare("DELETE FROM rate_limits WHERE key = ?").run(key);

/* ---------- recovery codes: Jarvis has no email, so a forgotten password is reset with a code the user kept ---------- */

// 32 symbols, so each random byte maps without bias; no I, O, 0 or 1 to misread.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Four groups of five: 100 random bits, written like ABCDE-FGHJK-LMNPQ-RSTUV. */
function makeRecoveryCode(): string {
  const raw = [...randomBytes(20)].map((b) => CODE_ALPHABET[b % 32]).join("");
  return raw.match(/.{5}/g)!.join("-");
}
const codeHash = (code: string) => hashToken(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

/** Replaces the user's recovery code; the old one stops working. The code is returned once and never stored. */
export function issueRecoveryCode(userId: number): string {
  const code = makeRecoveryCode();
  db().prepare("UPDATE users SET recovery_hash = ? WHERE id = ?").run(codeHash(code), userId);
  audit(userId, "recovery.issued", "user", userId);
  return code;
}

export const hasRecoveryCode = (userId: number) =>
  !!(db().prepare("SELECT recovery_hash FROM users WHERE id = ?").get(userId) as { recovery_hash: string | null } | undefined)?.recovery_hash;

/**
 * Sets a new password when the email and recovery code match. The code is used up: a new one is issued and
 * returned, and every device is signed out. Null when they don't match, without saying which part was wrong.
 */
export async function resetWithRecoveryCode(email: string, code: string, next: string): Promise<{ user: User; code: string } | null> {
  const row = db().prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
  const given = Buffer.from(codeHash(code), "hex");
  const stored = typeof row?.recovery_hash === "string" ? Buffer.from(row.recovery_hash, "hex") : randomBytes(32);
  if (!row || typeof row.recovery_hash !== "string" || !timingSafeEqual(given, stored)) return null;
  const hash = await hashPassword(next);
  const fresh = makeRecoveryCode();
  const user = toUser(row);
  transaction(db(), () => {
    db().prepare("UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?").run(hash, codeHash(fresh), user.id);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    audit(user.id, "password.reset", "user", user.id);
  });
  return { user, code: fresh };
}
