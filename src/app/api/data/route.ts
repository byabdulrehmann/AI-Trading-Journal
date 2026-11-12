import { z } from "zod";
import { body, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { deleteAllData, exportAll } from "@/lib/server/repo/journal";
import { stopService } from "@/lib/server/mt5/client";
import { listConnections } from "@/lib/server/repo/mt5";

/** Full JSON export of everything Jarvis stores. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return new Response(JSON.stringify(exportAll(user.id), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="jarvis-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

/** Permanently deletes all local data. Requires the literal word DELETE. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ confirm: z.literal("DELETE") }));
  if (data instanceof Response) return data;
  const hadConnection = listConnections(user.id).length > 0;
  deleteAllData(user.id);
  // The terminal may still be signed in to an account just deleted.
  if (hadConnection) await stopService();
  return json({ ok: true });
}
