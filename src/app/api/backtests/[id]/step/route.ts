import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { stepSession } from "@/lib/server/backtests";
import { body, fail, idParam, json } from "@/lib/server/http";

/** Forward only: a backtest can't take back a bar it has already seen. */
export async function POST(req: Request, ctx: RouteContext<"/api/backtests/[id]/step">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Session not found.", 404);
  const data = await body(req, z.object({ bars: z.number().int().min(1).max(500) }));
  if (data instanceof Response) return data;
  const r = await stepSession(user.id, id, data.bars);
  return r.ok ? json({ ok: true }) : fail(r.reason, r.status ?? 422);
}
