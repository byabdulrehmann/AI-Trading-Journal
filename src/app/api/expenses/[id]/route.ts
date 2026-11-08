import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { deleteExpense } from "@/lib/server/progress";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteExpense(user.id, id) ? json({ ok: true }) : fail("Entry not found.", 404);
}
