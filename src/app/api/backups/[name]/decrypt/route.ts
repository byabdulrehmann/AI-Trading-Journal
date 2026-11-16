import { z } from "zod";
import { clearRateLimit, rateLimited, requireOwner } from "@/lib/server/auth";
import { readBackupPlain } from "@/lib/server/backup";
import { body, fail } from "@/lib/server/http";

/** An encrypted backup as a plain database file, for restoring. Needs the backup password; owner only. */
export async function POST(req: Request, ctx: RouteContext<"/api/backups/[name]/decrypt">) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ password: z.string().max(200) }));
  if (data instanceof Response) return data;
  const key = `backup-password:${user.id}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const { name } = await ctx.params;
  const plain = readBackupPlain(name, data.password);
  if (plain === undefined) return fail("Backup not found.", 404);
  if (plain === null) return fail("That backup password doesn't open this backup.", 401);
  clearRateLimit(key);
  return new Response(new Uint8Array(plain), {
    headers: { "content-type": "application/vnd.sqlite3", "content-disposition": `attachment; filename="${name.replace(/\.sealed$/, "")}"`, "cache-control": "no-store" },
  });
}
