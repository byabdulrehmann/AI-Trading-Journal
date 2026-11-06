import "server-only";
import { db, now, transaction } from "../db";
import { audit } from "./audit";
import { VERSIONS_KEPT, previewOf, shouldSnapshot, type Note, type NoteInput, type NoteLink, type NoteLinkInput, type NoteSummary, type NoteVersion } from "@/lib/domain/notes";

type Row = { id: number; title: string; body: string; folder_id: number | null; tags: string; is_sample: number; created_at: string; updated_at: string };

const toSummary = (r: Row): NoteSummary => ({ id: r.id, title: r.title, preview: previewOf(r.body), folderId: r.folder_id, tags: JSON.parse(r.tags), isSample: r.is_sample === 1, updatedAt: r.updated_at });

export interface NoteFilters {
  folderId?: number | "none";
  tag?: string;
  q?: string;
  tradeId?: number;
  day?: string;
  includeSample?: boolean;
}

export function listNotes(userId: number, f: NoteFilters = {}): NoteSummary[] {
  const where = ["n.user_id = ?", "n.deleted_at IS NULL"];
  const args: (string | number)[] = [userId];
  const add = (sql: string, ...values: (string | number)[]) => {
    where.push(sql);
    args.push(...values);
  };
  if (!f.includeSample) add("n.is_sample = 0");
  if (f.folderId === "none") add("n.folder_id IS NULL");
  else if (f.folderId) add("n.folder_id = ?", f.folderId);
  if (f.tag) add("EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value = ?)", f.tag);
  if (f.tradeId) add("EXISTS (SELECT 1 FROM note_links l WHERE l.note_id = n.id AND l.trade_id = ?)", f.tradeId);
  if (f.day) add("EXISTS (SELECT 1 FROM note_links l WHERE l.note_id = n.id AND l.day = ?)", f.day);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, "\\$&")}%`;
    add("(n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')", like, like, like);
  }
  const rows = db().prepare(`SELECT n.* FROM notes n WHERE ${where.join(" AND ")} ORDER BY n.updated_at DESC, n.id DESC LIMIT 500`).all(...args) as Row[];
  return rows.map(toSummary);
}

function linksOf(noteId: number): NoteLink[] {
  const rows = db()
    .prepare(`SELECT l.trade_id, l.day, t.symbol, t.opened_at FROM note_links l
      LEFT JOIN trades t ON t.id = l.trade_id
      WHERE l.note_id = ? AND (l.trade_id IS NULL OR t.deleted_at IS NULL) ORDER BY l.id`)
    .all(noteId) as { trade_id: number | null; day: string | null; symbol: string | null; opened_at: string | null }[];
  return rows.map((r) => (r.trade_id !== null ? { kind: "trade", tradeId: r.trade_id, day: null, label: `${r.symbol}, #${r.trade_id}` } : { kind: "day", tradeId: null, day: r.day, label: r.day as string }));
}

function versionsOf(noteId: number): NoteVersion[] {
  const rows = db().prepare("SELECT id, title, body, created_at FROM note_versions WHERE note_id = ? ORDER BY id DESC").all(noteId) as { id: number; title: string; body: string; created_at: string }[];
  return rows.map((v) => ({ id: v.id, title: v.title, preview: previewOf(v.body, 120), createdAt: v.created_at }));
}

export function getNote(userId: number, id: number): Note | null {
  const r = db().prepare("SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as Row | undefined;
  return r ? { ...toSummary(r), body: r.body, createdAt: r.created_at, links: linksOf(id), versions: versionsOf(id) } : null;
}

export const folderBelongs = (userId: number, folderId: number) => Boolean(db().prepare("SELECT 1 FROM note_folders WHERE id = ? AND user_id = ?").get(folderId, userId));

/** Links to another user's trades are dropped, not stored. */
function saveLinks(userId: number, noteId: number, links: NoteLinkInput[]) {
  const conn = db();
  conn.prepare("DELETE FROM note_links WHERE note_id = ?").run(noteId);
  const insert = conn.prepare("INSERT OR IGNORE INTO note_links (note_id, trade_id, day) VALUES (?, ?, ?)");
  for (const l of links) {
    if (l.kind === "day") insert.run(noteId, null, l.day);
    else if (conn.prepare("SELECT 1 FROM trades WHERE id = ? AND user_id = ?").get(l.tradeId, userId)) insert.run(noteId, l.tradeId, null);
  }
}

export function createNote(userId: number, n: NoteInput, at = now()): Note {
  const id = transaction(db(), () => {
    const res = db().prepare("INSERT INTO notes (user_id, folder_id, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, n.folderId, n.title, n.body, JSON.stringify(n.tags), at, at);
    const created = Number(res.lastInsertRowid);
    saveLinks(userId, created, n.links);
    return created;
  });
  return getNote(userId, id) as Note;
}

function snapshot(noteId: number, title: string, body: string, at: string) {
  const conn = db();
  conn.prepare("INSERT INTO note_versions (note_id, title, body, created_at) VALUES (?, ?, ?, ?)").run(noteId, title, body, at);
  conn.prepare("DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT ?)").run(noteId, noteId, VERSIONS_KEPT);
}

/** Keeps what's being replaced, at most once per sitting. The clock is a parameter for the tests. */
export function updateNote(userId: number, id: number, p: Partial<NoteInput>, at = now()): Note | null {
  const conn = db();
  const cur = conn.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as Row | undefined;
  if (!cur) return null;
  const title = p.title ?? cur.title;
  const body = p.body ?? cur.body;
  const changed = title !== cur.title || body !== cur.body;
  transaction(conn, () => {
    const last = conn.prepare("SELECT MAX(created_at) AS at FROM note_versions WHERE note_id = ?").get(id) as { at: string | null };
    if (shouldSnapshot(changed, last.at, at)) snapshot(id, cur.title, cur.body, at);
    conn.prepare("UPDATE notes SET title = ?, body = ?, folder_id = ?, tags = ?, updated_at = ? WHERE id = ?")
      .run(title, body, p.folderId === undefined ? cur.folder_id : p.folderId, p.tags ? JSON.stringify(p.tags) : cur.tags, at, id);
    if (p.links) saveLinks(userId, id, p.links);
  });
  return getNote(userId, id);
}

/** What's there now is kept as a version first, so restoring can itself be undone. */
export function restoreVersion(userId: number, id: number, versionId: number, at = now()): Note | null {
  const conn = db();
  const cur = conn.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as Row | undefined;
  const v = conn.prepare("SELECT title, body FROM note_versions WHERE id = ? AND note_id = ?").get(versionId, id) as { title: string; body: string } | undefined;
  if (!cur || !v) return null;
  transaction(conn, () => {
    snapshot(id, cur.title, cur.body, at);
    conn.prepare("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?").run(v.title, v.body, at, id);
  });
  return getNote(userId, id);
}

/** Soft, so the page can offer undo. purgeDeletedTrades removes them after 30 days, as it does trades. */
export function setNoteDeleted(userId: number, id: number, deleted: boolean): boolean {
  const changes = Number(db().prepare("UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ?").run(deleted ? now() : null, id, userId).changes);
  if (changes) audit(userId, deleted ? "note.deleted" : "note.restored", "note", id);
  return changes > 0;
}

export const noteTags = (userId: number, includeSample: boolean): string[] =>
  (db().prepare(`SELECT DISTINCT j.value AS tag FROM notes n, json_each(n.tags) j WHERE n.user_id = ? AND n.deleted_at IS NULL${includeSample ? "" : " AND n.is_sample = 0"} ORDER BY tag`).all(userId) as { tag: string }[]).map((r) => r.tag);

// ---------- folders ----------

export interface NoteFolder {
  id: number;
  name: string;
  isSample: boolean;
  count: number;
}

export function listFolders(userId: number, includeSample: boolean): NoteFolder[] {
  const rows = db()
    .prepare(`SELECT f.id, f.name, f.is_sample, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL${includeSample ? "" : " AND n.is_sample = 0"}) AS count
      FROM note_folders f WHERE f.user_id = ?${includeSample ? "" : " AND f.is_sample = 0"} ORDER BY f.name`)
    .all(userId) as { id: number; name: string; is_sample: number; count: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, isSample: r.is_sample === 1, count: r.count }));
}

export const folderNameTaken = (userId: number, name: string, exceptId = 0) => Boolean(db().prepare("SELECT 1 FROM note_folders WHERE user_id = ? AND name = ? AND id != ?").get(userId, name, exceptId));

export const createFolder = (userId: number, name: string): number => Number(db().prepare("INSERT INTO note_folders (user_id, name, created_at) VALUES (?, ?, ?)").run(userId, name, now()).lastInsertRowid);

export const renameFolder = (userId: number, id: number, name: string) => Number(db().prepare("UPDATE note_folders SET name = ? WHERE id = ? AND user_id = ?").run(name, id, userId).changes) > 0;

/** Its notes stay, in no folder. */
export const deleteFolder = (userId: number, id: number) => Number(db().prepare("DELETE FROM note_folders WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;

// ---------- templates ----------

export const listTemplates = (userId: number) => db().prepare("SELECT id, name, body FROM note_templates WHERE user_id = ? ORDER BY name").all(userId) as { id: number; name: string; body: string }[];

export const templateNameTaken = (userId: number, name: string) => Boolean(db().prepare("SELECT 1 FROM note_templates WHERE user_id = ? AND name = ?").get(userId, name));

export const createTemplate = (userId: number, name: string, body: string) => Number(db().prepare("INSERT INTO note_templates (user_id, name, body, created_at) VALUES (?, ?, ?, ?)").run(userId, name, body, now()).lastInsertRowid);

export const deleteTemplate = (userId: number, id: number) => Number(db().prepare("DELETE FROM note_templates WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
