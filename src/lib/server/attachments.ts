import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Attachment } from "@/lib/domain/types";
import { dataPath, db, now } from "./db";
import { audit } from "./repo/audit";
import { getTrade, listAttachments } from "./repo/journal";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRADE = 30;
export const ATTACHMENT_KINDS = ["entry", "exit", "chart", "document"] as const;

/** A refusal the user can act on. Routes turn it into a response with this status. */
export class AttachmentError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ascii = (bytes: Buffer, from: number, to: number) => bytes.subarray(from, to).toString("latin1");

/** The file's real type, from its first bytes. The client's type and extension are never consulted. */
export function sniffType(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: "image/jpeg", ext: "jpg" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (ascii(bytes, 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

/** For display and the download name only: the stored file's name is always random. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>:|?*;%\u202a-\u202e\u2066-\u2069]/g, "").replace(/^\.+/, "").trim().slice(-120);
  return clean || "attachment";
}

/** "setup.exe" holding a PDF downloads as "setup.pdf", so the name can't promise what the bytes aren't. */
function withExtension(name: string, ext: string): string {
  const stem = name.replace(/\.[^.]*$/, "") || "attachment";
  return `${stem}.${ext}`;
}

export function saveAttachment(userId: number, tradeId: number, input: { kind: Attachment["kind"]; filename: string; bytes: Buffer }): Attachment {
  if (!getTrade(userId, tradeId)) throw new AttachmentError("Trade not found.", 404);
  if (input.bytes.length === 0) throw new AttachmentError("That file is empty.", 422);
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError("Files can be up to 10 MB.", 413);
  const type = sniffType(input.bytes);
  if (!type) throw new AttachmentError("Only PNG, JPEG, WEBP and PDF files can be attached.", 415);
  const conn = db();
  const { n } = conn.prepare("SELECT COUNT(*) AS n FROM attachments WHERE trade_id = ?").get(tradeId) as { n: number };
  if (n >= MAX_ATTACHMENTS_PER_TRADE) throw new AttachmentError(`A trade can have up to ${MAX_ATTACHMENTS_PER_TRADE} attachments.`, 422);

  const storedName = `${randomUUID()}.${type.ext}`;
  const file = path.join(/*turbopackIgnore: true*/ dataPath("attachments"), storedName);
  writeFileSync(file, input.bytes, { flag: "wx" });
  try {
    const res = conn
      .prepare("INSERT INTO attachments (trade_id, user_id, kind, filename, mime, size, stored_name, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(tradeId, userId, input.kind, withExtension(safeFilename(input.filename), type.ext), type.mime, input.bytes.length, storedName, createHash("sha256").update(input.bytes).digest("hex"), now());
    const id = Number(res.lastInsertRowid);
    audit(userId, "attachment.added", "attachment", id, { tradeId, mime: type.mime, size: input.bytes.length });
    return listAttachments(tradeId).find((a) => a.id === id)!;
  } catch (err) {
    unlinkSync(file);
    throw err;
  }
}

type Row = { id: number; trade_id: number; filename: string; mime: string; stored_name: string };

function ownedRow(userId: number, id: number): Row | null {
  const row = db()
    .prepare("SELECT a.id, a.trade_id, a.filename, a.mime, a.stored_name FROM attachments a JOIN trades t ON t.id = a.trade_id WHERE a.id = ? AND t.user_id = ? AND t.deleted_at IS NULL")
    .get(id, userId) as Row | undefined;
  return row ?? null;
}

export function readAttachment(userId: number, id: number): { filename: string; mime: string; bytes: Buffer } | null {
  const row = ownedRow(userId, id);
  if (!row) return null;
  try {
    return { filename: row.filename, mime: row.mime, bytes: readFileSync(path.join(/*turbopackIgnore: true*/ dataPath("attachments"), row.stored_name)) };
  } catch {
    return null; // The row outlived its file: same answer as a missing attachment.
  }
}

export function deleteAttachment(userId: number, id: number): boolean {
  const row = ownedRow(userId, id);
  if (!row) return false;
  db().prepare("DELETE FROM attachments WHERE id = ?").run(id);
  try {
    unlinkSync(path.join(/*turbopackIgnore: true*/ dataPath("attachments"), row.stored_name));
  } catch {
    // Already gone: the row is what the app reads.
  }
  audit(userId, "attachment.removed", "attachment", id, { tradeId: row.trade_id });
  return true;
}

/** RFC 6266: an ASCII fallback plus the exact name. Images open in place, PDFs download. */
export function contentDisposition(mime: string, filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = mime.startsWith("image/") ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
