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
const SESSION_DAYS = 14;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  name: z.string().trim().max(60).default(""),
});

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
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
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  const conn = db();
  conn.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
  conn.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(hashToken(token), userId, now(), expires.toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" && process.env.JARVIS_HTTPS === "1",
    path: "/",
    expires,
  });
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
  const row = db()
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?")
    .get(hashToken(token), now()) as Row | undefined;
  return row ? toUser(row) : null;
}

/** Every API route starts with this. Returns the signed-in user or the 401 to send back. */
export async function requireUser(): Promise<User | Response> {
  return (await currentUser()) ?? Response.json({ error: "Please sign in." }, { status: 401 });
}

/** For what belongs to the computer rather than to one user, such as the TradBot-I link. */
export async function requireOwner(): Promise<User | Response> {
  const user = await requireUser();
  if (user instanceof Response || user.isOwner) return user;
  return Response.json({ error: "Only the owner of this installation can do that." }, { status: 403 });
}

// shortcut: per-process memory, fine for one local server; shared storage needed if this ever runs as several.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60000;
const MAX_ATTEMPTS = 8;

export function rateLimited(key: string): boolean {
  const t = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < t) {
    attempts.set(key, { count: 1, resetAt: t + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

export const clearRateLimit = (key: string) => attempts.delete(key);
