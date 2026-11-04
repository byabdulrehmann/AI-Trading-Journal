import { z } from "zod";
import { MEMORY_KINDS } from "@/lib/domain/types";
import { body, dynamic, fail, idParam, json } from "@/lib/server/http";
import { deleteMemory, updateMemory } from "@/lib/server/repo/jarvis";

const Patch = z.object({
  content: z.string().trim().min(3).max(500).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/jarvis/memories/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid memory id.", 404);
  const data = await body(req, Patch);
  if (data instanceof Response) return data;
  const memory = updateMemory(id, data);
  return memory ? json({ memory }) : fail("Memory not found.", 404);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jarvis/memories/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id || !deleteMemory(id)) return fail("Memory not found.", 404);
  return json({ ok: true });
}
