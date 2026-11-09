import { requireUser } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { createBackup, listBackups } from "@/lib/server/backup";
import { dataPath } from "@/lib/server/db";

const OWNER_ONLY = "Backups copy every user's journal, so only the owner can manage them.";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.isOwner) return fail(OWNER_ONLY, 403);
  return json({ backups: listBackups(), folder: dataPath("backups") });
}

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.isOwner) return fail(OWNER_ONLY, 403);
  return json({ backup: createBackup("manual") }, 201);
}
