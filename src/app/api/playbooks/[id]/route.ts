import { PlaybookPatch } from "@/lib/domain/playbooks";
import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json, patchBody } from "@/lib/server/http";
import { deletePlaybook, playbookNameTaken, updatePlaybook } from "@/lib/server/repo/playbooks";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Playbook not found.", 404);
  const data = await patchBody(req, PlaybookPatch);
  if (data instanceof Response) return data;
  if (data.name && playbookNameTaken(user.id, data.name, id)) return fail("You already have a playbook with that name.", 422, [{ path: "name", message: "You already have a playbook with that name." }]);
  const playbook = updatePlaybook(user.id, id, data);
  return playbook ? json({ playbook }) : fail("Playbook not found.", 404);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Playbook not found.", 404);
  return deletePlaybook(user.id, id) ? json({ ok: true }) : fail("Playbook not found.", 404);
}
