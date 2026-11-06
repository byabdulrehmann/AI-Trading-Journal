import { NOTE_TEMPLATES, TemplateInput } from "@/lib/domain/notes";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { createTemplate, templateNameTaken } from "@/lib/server/repo/notes";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, TemplateInput);
  if (data instanceof Response) return data;
  if (templateNameTaken(user.id, data.name) || NOTE_TEMPLATES.some((t) => t.name.toLowerCase() === data.name.toLowerCase())) return fail("There's already a template with that name.", 422, [{ path: "name", message: "There's already a template with that name." }]);
  return json({ id: createTemplate(user.id, data.name, data.body) }, 201);
}
