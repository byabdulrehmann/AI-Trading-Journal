import { z } from "zod";
import { MEMORY_KINDS } from "@/lib/domain/types";
import { body, fail, idParam, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { deleteMemory, updateMemory } from "@/lib/server/repo/jarvis";

const Patch = z.object({
  content: z.string().trim().min(3).max(500).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/jarvis/memories/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid memory id.", 404);
  const data = await body(req, Patch);
  if (data instanceof Response) return data;
  const memory = updateMemory(user.id, id, data);
  return memory ? json({ memory }) : fail("Memory not found.", 404);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jarvis/memories/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !deleteMemory(user.id, id)) return fail("Memory not found.", 404);
  return json({ ok: true });
}
