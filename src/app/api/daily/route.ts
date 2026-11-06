import { DailyInput } from "@/lib/domain/types";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { getDay, listDays, saveDay } from "@/lib/server/repo/daily";

/** One day's plan and recap with ?date=, or every day that has notes. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const includeSample = params.get("includeSample") === "1";
  const date = params.get("date");
  if (date === null) return json({ days: listDays(user.id, includeSample) });
  const parsed = DailyInput.shape.date.safeParse(date);
  if (!parsed.success) return fail("Invalid date.", 400);
  return json({ entry: getDay(user.id, parsed.data, includeSample) });
}

export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, DailyInput);
  if (data instanceof Response) return data;
  return json({ entry: saveDay(user.id, data) });
}
