import { MissedInput } from "@/lib/domain/playbooks";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { createMissed, getPlaybook, listMissed } from "@/lib/server/repo/playbooks";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ missed: listMissed(user.id, new URL(req.url).searchParams.get("includeSample") === "1") });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, MissedInput);
  if (data instanceof Response) return data;
  if (data.strategyId !== null && !getPlaybook(user.id, data.strategyId)) return fail("Playbook not found.", 404);
  return json({ missed: createMissed(user.id, data) }, 201);
}
