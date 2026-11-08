import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { RoutineCheck, routineDay, setRoutineCheck } from "@/lib/server/progress";

export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, RoutineCheck);
  if (data instanceof Response) return data;
  const r = setRoutineCheck(user.id, data);
  return r.ok ? json({ day: routineDay(user.id, data.date) }) : fail(r.reason, r.status);
}
