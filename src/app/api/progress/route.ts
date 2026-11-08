import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { progressOverview } from "@/lib/server/progress";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json(progressOverview(user.id, new URL(req.url).searchParams.get("includeSample") === "1"));
}
