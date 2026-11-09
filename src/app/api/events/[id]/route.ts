import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteEvent } from "@/lib/server/news";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/events/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteEvent(user.id, id) ? json({ ok: true }) : fail("Event not found.", 404);
}
