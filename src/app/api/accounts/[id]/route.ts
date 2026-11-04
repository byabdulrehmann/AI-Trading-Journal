import { AccountUpdate } from "@/lib/domain/types";
import { fail, idParam, json, patchBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { updateAccount } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function PATCH(req: Request, ctx: RouteContext<"/api/accounts/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid account id.", 404);
  const data = await patchBody(req, AccountUpdate);
  if (data instanceof Response) return data;
  const account = updateAccount(user.id, id, data);
  if (!account) return fail("Account not found.", 404);
  recordActivity(user.id, "settings.changed", { setting: "accounts.update", fields: Object.keys(data) });
  return json({ account });
}
