import { requireUser } from "@/lib/server/auth";
import { contentDisposition, deleteAttachment, readAttachment } from "@/lib/server/attachments";
import { fail, idParam, json } from "@/lib/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const file = id ? readAttachment(user.id, id) : null;
  if (!file) return fail("Attachment not found.", 404);
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "x-content-type-options": "nosniff",
      "content-disposition": contentDisposition(file.mime, file.filename),
      "cache-control": "private, no-store",
    },
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/attachments/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteAttachment(user.id, id) ? json({ ok: true }) : fail("Attachment not found.", 404);
}
