import { z } from "zod";
import { endOtherSessions, listSessions, requireUser } from "@/lib/server/auth";
import { body, json } from "@/lib/server/http";

/** The browsers signed in to this account. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ sessions: await listSessions(user.id) });
}

const Body = z.object({ id: z.number().int().positive().optional() });

/** Signs out one other browser, or all of them when no id is sent. This browser stays signed in. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  return json({ ended: await endOtherSessions(user.id, data.id) });
}
