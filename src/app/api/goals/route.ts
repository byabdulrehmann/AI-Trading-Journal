import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { GoalInput, createGoal } from "@/lib/server/progress";

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, GoalInput);
  if (data instanceof Response) return data;
  const r = createGoal(user.id, data);
  return r.ok ? json({ id: r.id }, 201) : fail(r.reason, 422);
}
