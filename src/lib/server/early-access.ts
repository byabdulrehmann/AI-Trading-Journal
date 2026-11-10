import "server-only";
import { z } from "zod";
import { db, now } from "./db";
import { audit } from "./repo/audit";

/** Strips control characters, which have no business in a name or a note and can mangle a log or a CSV later. */
const clean = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim())
    .pipe(z.string().max(max, `Keep it under ${max} characters`));

export const EarlyAccessInput = z.object({
  name: clean(80).pipe(z.string().min(1, "Tell us your name")),
  email: z.string().trim().toLowerCase().max(200).email("Enter a valid email"),
  trades: clean(120).default(""),
  message: clean(1000).default(""),
  /** A field people never see: anything in it came from a bot. */
  website: z.string().max(200).default(""),
});
export type EarlyAccessInput = z.infer<typeof EarlyAccessInput>;

/** Enough for any real interest, small enough that a flood can't fill the disk. */
export const MAX_REQUESTS = 1000;

export interface EarlyAccessRequest {
  id: number;
  name: string;
  email: string;
  trades: string;
  message: string;
  createdAt: string;
}

export function saveEarlyAccess(input: EarlyAccessInput): { ok: true } | { ok: false; reason: string } {
  const conn = db();
  const { n } = conn.prepare("SELECT COUNT(*) AS n FROM early_access").get() as { n: number };
  if (n >= MAX_REQUESTS) return { ok: false, reason: "The request list is full for now. Please try again later." };
  const res = conn
    .prepare("INSERT INTO early_access (name, email, trades, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.name, input.email, input.trades, input.message, now());
  audit(null, "early_access.requested", "early_access", Number(res.lastInsertRowid));
  return { ok: true };
}

export function listEarlyAccess(): EarlyAccessRequest[] {
  return (db().prepare("SELECT id, name, email, trades, message, created_at FROM early_access ORDER BY created_at DESC, id DESC").all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    name: r.name as string,
    email: r.email as string,
    trades: r.trades as string,
    message: r.message as string,
    createdAt: r.created_at as string,
  }));
}

export const deleteEarlyAccess = (id: number) => Number(db().prepare("DELETE FROM early_access WHERE id = ?").run(id).changes) > 0;
