import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/auth";
import { tradbot } from "@/lib/server/tradbot/bridge";
import { recordActivity } from "@/lib/server/repo/activity";

const Body = z.object({ text: z.string().trim().min(1, "Type a message").max(4000, "Keep messages under 4,000 characters") });

/** Sends a typed message into TradBot-I's live session. The reply arrives on the event stream. */
export async function POST(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const res = await tradbot().command(data.text);
  if (!res.ok) return fail(res.error, res.status);
  recordActivity(user.id, "tradbot.message", { length: data.text.length });
  return json({ ok: true });
}
