import { FolderInput } from "@/lib/domain/notes";
import { requireUser } from "@/lib/server/auth";
import { body, fail, idParam, json } from "@/lib/server/http";
import { deleteFolder, folderNameTaken, renameFolder } from "@/lib/server/repo/notes";

type Ctx = { params: Promise<{ id: string }> };
const missing = () => fail("Folder not found.", 404);

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return missing();
  const data = await body(req, FolderInput);
  if (data instanceof Response) return data;
  if (folderNameTaken(user.id, data.name, id)) return fail("You already have a folder with that name.", 422, [{ path: "name", message: "You already have a folder with that name." }]);
  return renameFolder(user.id, id, data.name) ? json({ ok: true }) : missing();
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteFolder(user.id, id) ? json({ ok: true }) : missing();
}
