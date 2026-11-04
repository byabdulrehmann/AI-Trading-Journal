import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/auth";
import { tradbot } from "@/lib/server/tradbot/bridge";

// TradBot-I issues 6-character one-time keys (dashboard/server.py new_key).
const Body = z.object({ pin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, "The key is 6 letters or digits") });

export async function POST(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const res = await tradbot().pair(data.pin);
  return res.ok ? json({ ok: true, status: tradbot().status() }) : fail(res.error, 422);
}

/** Forgets the pairing on this side. TradBot-I drops its own copy when it restarts. */
export async function DELETE() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  tradbot().forget();
  return json({ ok: true });
}
