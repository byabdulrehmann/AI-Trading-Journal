import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteMissed } from "@/lib/server/repo/playbooks";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteMissed(user.id, id) ? json({ ok: true }) : fail("Missed trade not found.", 404);
}
