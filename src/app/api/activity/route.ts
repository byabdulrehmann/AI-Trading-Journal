import { ACTIVITY_TYPES } from "@/lib/domain/types";
import { dynamic, json } from "@/lib/server/http";
import { clearActivity, listActivity } from "@/lib/server/repo/activity";

export async function GET() {
  await dynamic();
  return json({ events: listActivity(), types: ACTIVITY_TYPES });
}

export async function DELETE() {
  await dynamic();
  return json({ removed: clearActivity() });
}
