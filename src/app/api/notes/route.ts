import { z } from "zod";
import { NOTE_TEMPLATES, NoteInput } from "@/lib/domain/notes";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { createNote, folderBelongs, listFolders, listNotes, listTemplates, noteTags } from "@/lib/server/repo/notes";

const Query = z.object({
  folder: z.union([z.literal("none"), z.coerce.number().int().positive()]).optional(),
  tag: z.string().trim().max(30).optional(),
  q: z.string().trim().max(100).optional(),
  tradeId: z.coerce.number().int().positive().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeSample: z.enum(["1"]).optional(),
});

/** Notes matching the query, plus the folders, tags and templates the page needs beside them. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const raw = Object.fromEntries([...new URL(req.url).searchParams].filter(([k, v]) => v !== "" && k in Query.shape));
  const q = Query.safeParse(raw);
  if (!q.success) return fail("Invalid note filters.", 400);
  const includeSample = q.data.includeSample === "1";
  return json({
    // Asking for one trade or day means that trade or day's notes, sample or not.
    notes: listNotes(user.id, { folderId: q.data.folder, tag: q.data.tag, q: q.data.q, tradeId: q.data.tradeId, day: q.data.day, includeSample: includeSample || Boolean(q.data.tradeId) }),
    folders: listFolders(user.id, includeSample),
    tags: noteTags(user.id, includeSample),
    templates: { builtIn: NOTE_TEMPLATES, own: listTemplates(user.id) },
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, NoteInput);
  if (data instanceof Response) return data;
  if (data.folderId !== null && !folderBelongs(user.id, data.folderId)) return fail("Folder not found.", 404);
  return json({ note: createNote(user.id, data) }, 201);
}
