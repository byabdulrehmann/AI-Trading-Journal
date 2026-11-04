import { AccountUpdate } from "@/lib/domain/types";
import { dynamic, fail, idParam, json, patchBody } from "@/lib/server/http";
import { updateAccount } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function PATCH(req: Request, ctx: RouteContext<"/api/accounts/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid account id.", 404);
  const data = await patchBody(req, AccountUpdate);
  if (data instanceof Response) return data;
  const account = updateAccount(id, data);
  if (!account) return fail("Account not found.", 404);
  recordActivity("settings.changed", { setting: "accounts.update", fields: Object.keys(data) });
  return json({ account });
}
