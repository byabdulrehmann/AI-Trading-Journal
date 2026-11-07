import { requireUser } from "@/lib/server/auth";
import { OrderInput, placeOrder } from "@/lib/server/backtests";
import { body, fail, idParam, json } from "@/lib/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/backtests/[id]/orders">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Session not found.", 404);
  const data = await body(req, OrderInput);
  if (data instanceof Response) return data;
  const r = await placeOrder(user.id, id, data);
  return r.ok ? json({ tradeId: r.tradeId }, 201) : fail(r.reason, r.status ?? 422);
}
