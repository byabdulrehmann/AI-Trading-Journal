import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { RoutineItemInput, addRoutineItem, routineDay, routineItems, todayFor } from "@/lib/server/progress";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const today = todayFor(user.id);
  const date = new URL(req.url).searchParams.get("date") ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Use a date like 2026-03-02.");
  return json({ today, day: routineDay(user.id, date), all: routineItems(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, RoutineItemInput);
  if (data instanceof Response) return data;
  return json({ item: addRoutineItem(user.id, data.label) }, 201);
}
