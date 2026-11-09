import { readFileSync } from "node:fs";
import { requireUser } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { backupPath, deleteBackup } from "@/lib/server/backup";

export async function GET(_req: Request, ctx: RouteContext<"/api/backups/[name]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.isOwner) return fail("Only the owner can download backups.", 403);
  const { name } = await ctx.params;
  const file = backupPath(name);
  if (!file) return fail("Backup not found.", 404);
  return new Response(readFileSync(file), { headers: { "content-type": "application/vnd.sqlite3", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/backups/[name]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.isOwner) return fail("Only the owner can delete backups.", 403);
  return deleteBackup((await ctx.params).name) ? json({ ok: true }) : fail("Backup not found.", 404);
}
