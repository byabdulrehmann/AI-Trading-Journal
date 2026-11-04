import { fail, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { undoImport } from "@/lib/server/repo/journal";

/** Removes every trade created by one import. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/imports/[batch]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { batch } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(batch)) return fail("Invalid import id.", 404);
  return json({ removed: undoImport(user.id, batch) });
}
