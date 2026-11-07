import { requireUser } from "@/lib/server/auth";
import { deleteSession, sessionView } from "@/lib/server/backtests";
import { fail, idParam, json } from "@/lib/server/http";
import { removeStoredFiles } from "@/lib/server/repo/journal";

export async function GET(_req: Request, ctx: RouteContext<"/api/backtests/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const view = id ? await sessionView(user.id, id) : null;
  return view ? json(view) : fail("Session not found.", 404);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/backtests/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const files = id ? deleteSession(user.id, id) : null;
  if (!files) return fail("Session not found.", 404);
  removeStoredFiles("attachments", files);
  return json({ ok: true });
}
