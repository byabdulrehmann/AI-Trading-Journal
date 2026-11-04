import { ACTIVITY_TYPES } from "@/lib/domain/types";
import { json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { clearActivity, listActivity } from "@/lib/server/repo/activity";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ events: listActivity(user.id), types: ACTIVITY_TYPES });
}

export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ removed: clearActivity(user.id) });
}
