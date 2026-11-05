import { fail, idParam, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getConnection, listOpenPositions } from "@/lib/server/repo/mt5";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam(new URL(req.url).searchParams.get("accountId") ?? "");
  if (!id || !getConnection(user.id, id)) return fail("Connection not found.", 404);
  return json({ positions: listOpenPositions(id) });
}
