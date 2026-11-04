import { z } from "zod";
import { body, dynamic, json } from "@/lib/server/http";
import { deleteAllData, exportAll } from "@/lib/server/repo/journal";
import { tradbot } from "@/lib/server/tradbot/bridge";

/** Full JSON export of everything Kestrel stores. */
export async function GET() {
  await dynamic();
  return new Response(JSON.stringify(exportAll(), null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="kestrel-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

/** Permanently deletes all local data. Requires the literal word DELETE. */
export async function DELETE(req: Request) {
  await dynamic();
  const data = await body(req, z.object({ confirm: z.literal("DELETE") }));
  if (data instanceof Response) return data;
  deleteAllData();
  // The bridge keeps the pairing token and recent transcript in memory.
  tradbot().forget();
  return json({ ok: true });
}
