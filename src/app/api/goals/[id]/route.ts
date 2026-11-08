import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteGoal } from "@/lib/server/progress";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/goals/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteGoal(user.id, id) ? json({ ok: true }) : fail("Goal not found.", 404);
}
