import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, fail, idParam, json } from "@/lib/server/http";
import { EventInput } from "@/lib/domain/econ";
import { createEvent, deleteAllEvents, eventsNearTrade, listEvents } from "@/lib/server/news";

/** ?tradeId= gives the events around one trade; ?from=&to= (ISO) a window; neither, everything. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams;
  if (q.has("tradeId")) {
    const id = idParam(q.get("tradeId") ?? "");
    const events = id ? eventsNearTrade(user.id, id) : null;
    return events ? json({ events }) : fail("Trade not found.", 404);
  }
  return json({ events: listEvents(user.id, q.get("from") ?? undefined, q.get("to") ?? undefined) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, EventInput);
  if (data instanceof Response) return data;
  const r = createEvent(user.id, data);
  return r.ok ? json({ ok: true, tagged: r.tagged }, 201) : fail(r.reason, 422);
}

/** Clears the whole calendar. Requires the literal word DELETE. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ confirm: z.literal("DELETE") }));
  if (data instanceof Response) return data;
  return json({ removed: deleteAllEvents(user.id) });
}
