import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { closePosition } from "@/lib/server/backtests";
import { body, fail, idParam, json } from "@/lib/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/backtests/[id]/close">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Session not found.", 404);
  const data = await body(req, z.object({ tradeId: z.number().int().positive() }));
  if (data instanceof Response) return data;
  const r = await closePosition(user.id, id, data.tradeId);
  return r.ok ? json({ ok: true }) : fail(r.reason, r.status ?? 422);
}
