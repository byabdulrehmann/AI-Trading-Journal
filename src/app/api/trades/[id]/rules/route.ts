import { ChecksInput } from "@/lib/domain/playbooks";
import { requireUser } from "@/lib/server/auth";
import { body, fail, idParam, json } from "@/lib/server/http";
import { saveChecklist, tradeChecklist } from "@/lib/server/repo/playbooks";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const list = id ? tradeChecklist(user.id, id) : null;
  return list ? json(list) : fail("Trade not found.", 404);
}

export async function PUT(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Trade not found.", 404);
  const data = await body(req, ChecksInput);
  if (data instanceof Response) return data;
  const list = saveChecklist(user.id, id, data.checked);
  return list ? json(list) : fail("Trade not found.", 404);
}
