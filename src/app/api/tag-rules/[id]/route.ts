import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteRule } from "@/lib/server/autotag";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/tag-rules/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteRule(user.id, id) ? json({ ok: true }) : fail("Rule not found.", 404);
}
