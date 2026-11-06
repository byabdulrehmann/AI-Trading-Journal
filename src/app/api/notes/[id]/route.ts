import { z } from "zod";
import { NotePatch } from "@/lib/domain/notes";
import { requireUser } from "@/lib/server/auth";
import { body, fail, idParam, json, patchBody } from "@/lib/server/http";
import { folderBelongs, getNote, restoreVersion, setNoteDeleted, updateNote } from "@/lib/server/repo/notes";

type Ctx = { params: Promise<{ id: string }> };
const missing = () => fail("Note not found.", 404);
const Action = z.discriminatedUnion("action", [z.object({ action: z.literal("undelete") }), z.object({ action: z.literal("restoreVersion"), versionId: z.number().int().positive() })]);

export async function GET(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const note = id ? getNote(user.id, id) : null;
  if (!note) return missing();
  if (new URL(req.url).searchParams.get("format") === "markdown") {
    const name = (note.title || "note").replace(/[^\w -]+/g, "").trim().slice(0, 80) || "note";
    return new Response(`# ${note.title || "Untitled"}\n\n${note.body}\n`, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}.md"` } });
  }
  return json({ note });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return missing();
  const data = await patchBody(req, NotePatch);
  if (data instanceof Response) return data;
  if (data.folderId && !folderBelongs(user.id, data.folderId)) return fail("Folder not found.", 404);
  const note = updateNote(user.id, id, data);
  return note ? json({ note }) : missing();
}

/** Undo a delete, or bring back an earlier version. */
export async function POST(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return missing();
  const data = await body(req, Action);
  if (data instanceof Response) return data;
  if (data.action === "undelete") return setNoteDeleted(user.id, id, false) ? json({ ok: true }) : missing();
  const note = restoreVersion(user.id, id, data.versionId);
  return note ? json({ note }) : missing();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && setNoteDeleted(user.id, id, true) ? json({ ok: true }) : missing();
}
