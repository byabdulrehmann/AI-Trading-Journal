import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { positioning, refreshCot } from "@/lib/server/market/cot";

/** Jarvis's positioning scorecard from the CFTC's weekly report, fetched when a newer one is due. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  await refreshCot();
  return json(positioning());
}
