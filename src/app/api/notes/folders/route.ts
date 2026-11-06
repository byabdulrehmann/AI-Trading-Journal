import { FolderInput } from "@/lib/domain/notes";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { createFolder, folderNameTaken } from "@/lib/server/repo/notes";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, FolderInput);
  if (data instanceof Response) return data;
  if (folderNameTaken(user.id, data.name)) return fail("You already have a folder with that name.", 422, [{ path: "name", message: "You already have a folder with that name." }]);
  return json({ id: createFolder(user.id, data.name) }, 201);
}
