import { requireUser } from "@/lib/server/auth";
import { z } from "zod";
import { body, fail, idParam, json } from "@/lib/server/http";
import { ChallengeInput, deleteChallenge, updateChallenge } from "@/lib/server/progress";

const Update = z.intersection(ChallengeInput, z.object({ archived: z.boolean().optional() }));

export async function PUT(req: Request, ctx: RouteContext<"/api/challenges/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Challenge not found.", 404);
  const data = await body(req, Update);
  if (data instanceof Response) return data;
  const r = updateChallenge(user.id, id, data);
  return r.ok ? json({ challenge: r.challenge }) : fail(r.reason, r.status);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/challenges/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  return id && deleteChallenge(user.id, id) ? json({ ok: true }) : fail("Challenge not found.", 404);
}
