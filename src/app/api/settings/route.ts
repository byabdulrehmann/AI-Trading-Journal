import { SettingsUpdate } from "@/lib/domain/types";
import { json, patchBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getSettings, updateSettings } from "@/lib/server/repo/settings";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ settings: getSettings(user.id) });
}

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await patchBody(req, SettingsUpdate);
  if (data instanceof Response) return data;
  // Provider/model changes go through /api/jarvis/providers so they're validated.
  if (data.jarvis) {
    delete data.jarvis.provider;
    delete data.jarvis.model;
  }
  const settings = updateSettings(user.id, data);
  const keys = [...Object.keys(data).filter((k) => k !== "jarvis"), ...Object.keys(data.jarvis ?? {}).map((k) => `jarvis.${k}`)];
  // Log after the update so turning tracking on is itself recorded, and turning it off is not.
  recordActivity(user.id, "settings.changed", { settings: keys });
  return json({ settings });
}
