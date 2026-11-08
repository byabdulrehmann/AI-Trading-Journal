import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json, patchBody } from "@/lib/server/http";
import { RoutineItemPatch, updateRoutineItem } from "@/lib/server/progress";

export async function PATCH(req: Request, ctx: RouteContext<"/api/routine/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Step not found.", 404);
  const data = await patchBody(req, RoutineItemPatch);
  if (data instanceof Response) return data;
  const item = updateRoutineItem(user.id, id, data);
  return item ? json({ item }) : fail("Step not found.", 404);
}
