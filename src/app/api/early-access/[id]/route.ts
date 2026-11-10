import { requireOwner } from "@/lib/server/auth";
import { deleteEarlyAccess } from "@/lib/server/early-access";
import { fail, idParam, json } from "@/lib/server/http";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/early-access/[id]">) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteEarlyAccess(id) ? json({ ok: true }) : fail("Request not found.", 404);
}
