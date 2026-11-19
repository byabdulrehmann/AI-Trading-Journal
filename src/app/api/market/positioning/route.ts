import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { PAIRS, positioning, refreshCot } from "@/lib/server/market/cot";
import { refreshFred } from "@/lib/server/market/fred";
import { refreshPrices } from "@/lib/server/market/prices";

/** Jarvis's scorecard: the CFTC's weekly positioning and, with a FRED key, macro readings, each fetched when due. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  refreshPrices(user.id, PAIRS); // in the background: the page asks again while it reads
  await Promise.all([refreshCot(), refreshFred()]);
  return json(positioning(user.id));
}
