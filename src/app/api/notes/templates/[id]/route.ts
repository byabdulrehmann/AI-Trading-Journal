import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteTemplate } from "@/lib/server/repo/notes";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteTemplate(user.id, id) ? json({ ok: true }) : fail("Template not found.", 404);
}
